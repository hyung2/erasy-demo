// 프라이버시 점수 엔진 v1 — 순수 산식(부수효과·DB 접근 없음).
// 정본(SSOT): 03-step02-mvp/score-spec-T3.0.md — 티어·가중치·캡·회복규칙 근거는 스펙 참조.
// 원칙: 1층 주신호는 계정당 1티어(worst-wins, 상관 신호 이중계상 방지),
//       2층 보조신호는 횡단 가산 후 캡(한계효용 체감), coverage는 점수 보정 아닌 정직 표기.
// DB 집계 → 신호 변환은 lib/score-service.ts가 담당(엔진은 순수 유지 = 단위검증 가능).

// ── 가중치 정본 (score-spec-T3.0 2장과 1:1) ──
export const SCORE_WEIGHTS = {
  base: 100,
  // 1층 주신호(계정당 1티어)
  breachPassword: 9, // P1a 유출 미해결 + 비밀번호 노출
  breachOther: 6, // P1b 유출 미해결(PII만)
  dormant: 5, // P2 휴면 24개월+ 비유출
  stale: 2, // P3 휴면 12~24개월
  overseasActive: 1, // P4 해외 + 활성
  // 2층 보조신호(합산 후 캡)
  reusePerAccount: 2,
  reuseCap: 8,
  no2faPerAccount: 1, // manual 계정 한정
  no2faCap: 4,
  suspiciousPerAccount: 3, // 최근 90일 이상접속
  suspiciousCap: 6,
  // 경계값
  dormantDays: 730,
  staleDays: 365,
  suspiciousWindowDays: 90,
} as const;

// 점수 입력 신호 — Account 컬럼/관계에서 파생(전부 자격증명과 무관한 메타 신호).
// T1.2 고정 5필드 보존 + 엔진 v1 티어 분해 필드 추가(상위호환).
export type ScoreSignals = {
  totalAccounts: number; // 총 연결 계정 수
  breachedCount: number; // 유출 미해결 계정 수(P1 전체)
  breachedPasswordCount: number; // P1 중 비밀번호 노출 계정 수(<= breachedCount)
  dormantCount: number; // P2: 휴면 24개월+ 비유출 계정 수
  staleCount: number; // P3: 휴면 12~24개월 계정 수
  overseasActiveCount: number; // P4: 해외 + 활성 계정 수
  reusedCount: number; // 비밀번호 재사용 계정 수(passwordReused, 회복 반영 후)
  no2faCount: number; // manual 계정 중 2FA 미설정 수(OAuth는 provider 위임 제외)
  suspiciousCount: number; // 최근 90일 이상접속 계정 수
};

// 확인 커버리지(정직성 표기) — 전체 대비 신호가 확인된 계정 비율.
export type ScoreCoverage = {
  coveredCount: number;
  totalCount: number;
  coverage: number; // coveredCount / totalCount (0~1)
};

export type ScoreResult = {
  score: number; // 0~100
  coverage: ScoreCoverage;
};

// ── 엔진 입력 행 — DB row/dummy 공용의 평면 shape(순수 함수 유지·단위검증용) ──
export type AccountSignalRow = {
  provider: 'google' | 'naver' | 'kakao' | 'apple' | 'manual';
  category: 'social' | 'overseas' | 'domestic';
  lastUsedDays: number | null; // null = 미확인(무감점 + coverage 하락)
  twoFactorEnabled: boolean;
  passwordReused: boolean;
  breachedUnresolved: boolean; // Breach 관계(resolved=false)에서 파생
  breachedPasswordExposed: boolean; // exposedFields에 "비밀번호" 포함
  suspiciousRecent: boolean; // 최근 90일 suspicious AccessLog 보유
  // 회복 신호(CleanupRequest done에서 파생)
  removed: boolean; // delete/revoke done → 계정 전체 감점 제외
  passwordChanged: boolean; // password_change done → 재사용 가산 해제
  sessionsCleared: boolean; // logout_sessions done → 이상접속 가산 해제
};

// 행 목록 → 신호 집계(티어 배정 + 회복규칙). worst-wins 순서 = P1a > P1b > P2 > P3 > P4.
export function deriveSignals(rows: AccountSignalRow[]): ScoreSignals {
  const W = SCORE_WEIGHTS;
  const s: ScoreSignals = {
    totalAccounts: rows.length,
    breachedCount: 0,
    breachedPasswordCount: 0,
    dormantCount: 0,
    staleCount: 0,
    overseasActiveCount: 0,
    reusedCount: 0,
    no2faCount: 0,
    suspiciousCount: 0,
  };

  for (const r of rows) {
    if (r.removed) continue; // 표면 제거 완료 — 총계·coverage에는 남고 감점만 제외

    // 1층 티어(상호배타)
    if (r.breachedUnresolved) {
      s.breachedCount += 1;
      if (r.breachedPasswordExposed) s.breachedPasswordCount += 1;
    } else if (r.lastUsedDays !== null && r.lastUsedDays >= W.dormantDays) {
      s.dormantCount += 1;
    } else if (r.lastUsedDays !== null && r.lastUsedDays >= W.staleDays) {
      s.staleCount += 1;
    } else if (r.category === 'overseas' && r.lastUsedDays !== null) {
      s.overseasActiveCount += 1;
    }
    // lastUsedDays === null → 티어 미부여(미확인 무감점, coverage로 정직 표기)

    // 2층 보조신호(횡단)
    if (r.passwordReused && !r.passwordChanged) s.reusedCount += 1;
    if (r.provider === 'manual' && !r.twoFactorEnabled) s.no2faCount += 1;
    if (r.suspiciousRecent && !r.sessionsCleared) s.suspiciousCount += 1;
  }
  return s;
}

// coverage 산출 — covered = lastUsedAt(사용 신호)이 확인된 계정.
export function deriveCoverage(rows: AccountSignalRow[]): ScoreCoverage {
  const coveredCount = rows.filter((r) => r.lastUsedDays !== null).length;
  const totalCount = rows.length;
  return {
    coveredCount,
    totalCount,
    coverage: totalCount === 0 ? 1 : coveredCount / totalCount,
  };
}

// 산식 본체 — score-spec-T3.0 2.1~2.2. coverage는 점수 미반영(정직 표기 전용, 시그니처 유지).
export function computePrivacyScore(
  signals: ScoreSignals,
  _coverage: ScoreCoverage,
): number {
  const W = SCORE_WEIGHTS;

  const breachOtherCount = signals.breachedCount - signals.breachedPasswordCount;
  const primary =
    signals.breachedPasswordCount * W.breachPassword +
    breachOtherCount * W.breachOther +
    signals.dormantCount * W.dormant +
    signals.staleCount * W.stale +
    signals.overseasActiveCount * W.overseasActive;

  const secondary =
    Math.min(signals.reusedCount * W.reusePerAccount, W.reuseCap) +
    Math.min(signals.no2faCount * W.no2faPerAccount, W.no2faCap) +
    Math.min(signals.suspiciousCount * W.suspiciousPerAccount, W.suspiciousCap);

  const raw = W.base - primary - secondary;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
