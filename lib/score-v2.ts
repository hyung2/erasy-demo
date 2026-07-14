// 안전도 점수 엔진 v2 — 다차원 스코어링(순수 산식, DB·부수효과 없음).
// 정본(SSOT): 03-step02-mvp/score-spec-v2-multidim.md + 투명설계안 v2(옵시디언).
//   v1(lib/score.ts)은 보존·미수정. v2는 별도 파일에서 처음부터 재설계.
// 원칙: 안전도 = 4축(유출 E·방치 S·위생 H·위협 T) 생존확률 곱셈 서브진단 + 최약축 지배 블렌드.
//   내부 계산은 raw float, 표시 시에만 round. 종합은 raw 축 점수로 계산.
// 레드팀 반영: [M4] p는 확률이 아닌 "심각도 계수"(값 불변) / [C2] H축 단조성 중립 처리
//   / [M3] 분모 0 재정규화. 근거·표는 SSOT 참조.
// DB 집계 → 신호 변환은 score-service(v2 전환 시)가 담당 — 엔진은 순수 유지(단위검증 가능).

// ── 심각도 계수·가중치 정본 (SSOT 11장 파라미터 일람과 1:1) ──
// 주: 아래 값은 "사고 기여 확률"이 아니라 도메인 서열·스케일을 캘리브레이션한 심각도 계수다([M4]).
//     실측 적합값 아님 — 교차검증 대상(SSOT 13장).
export const SCORE_V2_PARAMS = {
  // E — 유출 노출 (미해결 유출 건별 심각도)
  breachPassword: 0.35, // 유출 + 비밀번호 노출 (직접 탈취 경로)
  breachPiiOnly: 0.2, //  유출 + PII만 (피싱 간접 경로)
  // S — 방치 표면 (계정별 심각도)
  dormant24m: 0.1, //  휴면 24개월+
  stale12to24m: 0.05, // 휴면 12~24개월
  overseasActive: 0.02, // 해외 + 활성(<12개월)
  discovered: 0.03, // 미인지 + 미조치
  // H — 계정 위생 (비율축 가중)
  hygieneReuseWeight: 0.65, // 재사용(킬체인 본체)
  hygieneTfaWeight: 0.35, // 2FA(완화 계층)
  // T — 진행형 위협 (이상 접속 계정별 심각도)
  threatSuspicious: 0.4,
  // 종합 블렌드
  weights: { exposure: 0.35, hygiene: 0.3, surface: 0.2, threat: 0.15 },
  lambda: 0.45, // 최약축 혼합 비중 — 마스킹 차단 보장 최소값(>0.412)에서 여유
  // 경계값(일 단위)
  dormantDays: 730,
  staleDays: 365,
} as const;

export type AxisKey = 'exposure' | 'surface' | 'hygiene' | 'threat';
export type Grade = '양호' | '주의' | '위험';

export type ActionType =
  | 'password_change'
  | 'delete'
  | 'revoke'
  | 'logout_sessions'
  | 'resolve_breach'
  | 'enable_2fa';

// ── 엔진 입력 행 — DB row/dummy 공용 평면 shape(순수 유지·단위검증용) ──
// v1 AccountSignalRow에 v2 신호(discovered·accessLogObserved) 추가.
export type ScoreRowV2 = {
  provider: 'google' | 'naver' | 'kakao' | 'apple' | 'manual';
  category: 'social' | 'overseas' | 'domestic';
  lastUsedDays: number | null; // null = 미확인(무감점 + coverage 하락)
  twoFactorEnabled: boolean;
  passwordReused: boolean;
  discovered: boolean; // 미인지 계정(S축)
  breachedUnresolved: boolean; // Breach 관계(resolved=false)에서 파생(E축)
  breachedPasswordExposed: boolean; // exposedFields에 "비밀번호" 포함
  suspiciousRecent: boolean; // 최근 90일 suspicious AccessLog 보유(T축)
  accessLogObserved: boolean; // AccessLog row 존재(T coverage 관측 모수)
  // 회복 신호(CleanupRequest done / Breach.resolved 등에서 파생)
  removed: boolean; // delete/revoke done → 계정 전체 신호 제외(표면 소멸)
  passwordChanged: boolean; // password_change done → 재사용 분자 제외
  sessionsCleared: boolean; // logout_sessions done → 이상접속 인자 제거
};

export type AxisScore = {
  key: AxisKey;
  score: number | null; // raw float(표시 시 round). null = 미측정
  measured: boolean;
  coveredCount: number; // coverage 분자(관측된 계정)
  totalCount: number; // coverage 분모(전체 계정)
  coverage: number; // coveredCount / totalCount (0~1)
  topFinding: string | null; // 대표 근거 1줄
};

export type RecommendedAction = {
  axis: AxisKey;
  actionType: ActionType;
  accountIndices: number[]; // 대상 rows 인덱스
  expectedGain: number; // 완료 가정 시 종합 delta(하한 0 clamp)
};

export type ExpectedGainItem = {
  axis: AxisKey;
  actionType: ActionType;
  accountIndices: number[];
  expectedGain: number; // 하한 0 clamp([C2])
};

export type ScoreV2Result = {
  composite: number | null; // null = 측정 불가(측정 축 0개)
  measured: boolean;
  grade: Grade | null;
  weakestAxis: AxisKey | null;
  axes: Record<AxisKey, AxisScore>;
  coverage: number; // 헤드라인 대표 coverage = surface 축 값(SSOT 8장)
  recommendedAction: RecommendedAction | null;
  expectedGains: ExpectedGainItem[];
};

// ── 파생 판정 헬퍼 ──
function isStale(r: ScoreRowV2): boolean {
  return (
    r.lastUsedDays !== null &&
    r.lastUsedDays >= SCORE_V2_PARAMS.staleDays &&
    r.lastUsedDays < SCORE_V2_PARAMS.dormantDays
  );
}
function isDormant(r: ScoreRowV2): boolean {
  return r.lastUsedDays !== null && r.lastUsedDays >= SCORE_V2_PARAMS.dormantDays;
}
function isOverseasActive(r: ScoreRowV2): boolean {
  return (
    r.category === 'overseas' &&
    r.lastUsedDays !== null &&
    r.lastUsedDays < SCORE_V2_PARAMS.staleDays
  );
}

// ── 4.1 E — 유출 노출: 100 × ∏(1 − p_breach), 미해결 유출 건별(미제거 계정 한정) ──
export function computeExposure(rows: ScoreRowV2[]): AxisScore {
  const P = SCORE_V2_PARAMS;
  let survival = 1;
  let breachCount = 0;
  for (const r of rows) {
    if (r.removed || !r.breachedUnresolved) continue;
    const p = r.breachedPasswordExposed ? P.breachPassword : P.breachPiiOnly;
    survival *= 1 - p;
    breachCount += 1;
  }
  const total = rows.length;
  // coverage: 유출 대조 수행 계정(MVP 시드는 전수 대조 = 1.0).
  const measured = total > 0;
  return {
    key: 'exposure',
    score: measured ? 100 * survival : null,
    measured,
    coveredCount: total,
    totalCount: total,
    coverage: total === 0 ? 0 : 1,
    topFinding:
      breachCount > 0 ? `미해결 유출 ${breachCount}건 — 여기가 뚫린 문이에요` : null,
  };
}

// ── 4.2 S — 방치 표면: 100 × ∏(1 − p). 휴면 3단계 상호배타, 미인지·해외 독립 인자 ──
export function computeSurface(rows: ScoreRowV2[]): AxisScore {
  const P = SCORE_V2_PARAMS;
  let survival = 1;
  let dormantN = 0;
  let discoveredN = 0;
  let coveredCount = 0;
  for (const r of rows) {
    if (r.lastUsedDays !== null) coveredCount += 1; // coverage: 사용 이력 확인 계정
    if (r.removed) continue;
    // 휴면 3단계(상호배타, 계정당 최심 1개)
    if (isDormant(r)) {
      survival *= 1 - P.dormant24m;
      dormantN += 1;
    } else if (isStale(r)) {
      survival *= 1 - P.stale12to24m;
      dormantN += 1;
    } else if (isOverseasActive(r)) {
      survival *= 1 - P.overseasActive;
    }
    // 미인지(독립 인자) — 제거 이력이 없는 미인지 계정만(removed는 위에서 이미 skip)
    if (r.discovered) {
      survival *= 1 - P.discovered;
      discoveredN += 1;
    }
  }
  const total = rows.length;
  const measured = coveredCount > 0; // 사용 이력이 하나도 확인 안 되면 미측정
  const findings: string[] = [];
  if (dormantN > 0) findings.push(`${dormantN}개 계정이 무감시 상태`);
  if (discoveredN > 0) findings.push(`몰랐던 계정 ${discoveredN}개`);
  return {
    key: 'surface',
    score: measured ? 100 * survival : null,
    measured,
    coveredCount,
    totalCount: total,
    coverage: total === 0 ? 0 : coveredCount / total,
    topFinding: findings.length > 0 ? `${findings.join(' · ')} — 안 쓰면 지워요` : null,
  };
}

// ── 4.3 H — 계정 위생: 100 × (0.65×(1−reuseRate) + 0.35×tfaRate). 유일한 비율축 ──
// [C2] 단조성 중립 처리: 삭제된 계정 중 "위험"(재사용·비2FA)은 완전 배제(개선),
//   "안전"(고유비번·2FA)은 분모·분자에 신용 유지(중립). 삭제가 위생을 절대 내리지 않음.
//   → 위험 제거는 비율 개선, 안전 계정 제거는 중립. 워크스루(SSOT 12장) 전 숫자 재현.
export function computeHygiene(rows: ScoreRowV2[]): AxisScore {
  const P = SCORE_V2_PARAMS;

  // passwordHolders = manual ∪ 비밀번호 신호 관측(재사용 이력 또는 교체 이력).
  const isHolder = (r: ScoreRowV2) =>
    r.provider === 'manual' || r.passwordReused || r.passwordChanged;

  // 재사용 항 분모: 활성 holders + (제거된 holders 중 비재사용=안전 → 신용 유지).
  //   재사용(위험) holder 제거는 분자·분모 동시 제외(비율 개선).
  let holdersDenom = 0;
  let reuseNum = 0;
  // 2FA 항 분모: 활성 manual + (제거된 manual 중 2FA=안전 → 신용 유지).
  //   비2FA(위험) manual 제거는 분모에서 제외(비율 개선).
  let manualDenom = 0;
  let tfaNum = 0;

  let coveredCount = 0;
  for (const r of rows) {
    const holder = isHolder(r);
    const manual = r.provider === 'manual';
    if (holder) coveredCount += 1;

    if (r.removed) {
      // 안전한 계정만 신용 유지(중립), 위험한 계정은 완전 배제(개선).
      if (holder && !(r.passwordReused && !r.passwordChanged)) holdersDenom += 1; // 비재사용=안전
      if (manual && r.twoFactorEnabled) {
        manualDenom += 1;
        tfaNum += 1;
      }
      continue;
    }
    // 활성 계정
    if (holder) {
      holdersDenom += 1;
      if (r.passwordReused && !r.passwordChanged) reuseNum += 1;
    }
    if (manual) {
      manualDenom += 1;
      if (r.twoFactorEnabled) tfaNum += 1;
    }
  }

  const reuseMeasured = holdersDenom > 0;
  const tfaMeasured = manualDenom > 0;
  const total = rows.length;

  if (!reuseMeasured && !tfaMeasured) {
    // 양쪽 미측정 → 축 자체 미측정(측정 불가, 0점 아님)
    return {
      key: 'hygiene',
      score: null,
      measured: false,
      coveredCount,
      totalCount: total,
      coverage: total === 0 ? 0 : coveredCount / total,
      topFinding: null,
    };
  }

  const reuseRate = reuseMeasured ? reuseNum / holdersDenom : null;
  const tfaRate = tfaMeasured ? tfaNum / manualDenom : null;

  let score: number;
  if (reuseRate !== null && tfaRate !== null) {
    score = 100 * (P.hygieneReuseWeight * (1 - reuseRate) + P.hygieneTfaWeight * tfaRate);
  } else if (reuseRate !== null) {
    // manual 없음 → 재사용 항 100% 가중 재정규화([M3])
    score = 100 * (1 - reuseRate);
  } else {
    // holders 없이 manual만(비율 희석 없음) → 2FA 항 100% 가중 재정규화([M3])
    score = 100 * (tfaRate as number);
  }

  const finding =
    reuseRate !== null && reuseRate > 0
      ? `유출된 비밀번호를 ${reuseNum}개 계정에서 재사용 중 — 교체가 가장 급해요`
      : tfaRate !== null && tfaRate < 1
        ? '2단계 인증 미설정 계정이 있어요'
        : null;

  return {
    key: 'hygiene',
    score,
    measured: true,
    coveredCount,
    totalCount: total,
    coverage: total === 0 ? 0 : coveredCount / total,
    topFinding: finding,
  };
}

// ── 4.4 T — 진행형 위협: 100 × 0.60^k, k = 이상 접속 계정 수(미정리·미제거) ──
export function computeThreat(rows: ScoreRowV2[]): AxisScore {
  const P = SCORE_V2_PARAMS;
  let k = 0;
  let coveredCount = 0;
  for (const r of rows) {
    if (r.accessLogObserved && !r.removed) coveredCount += 1; // 관측 모수
    if (r.removed || r.sessionsCleared) continue;
    if (r.suspiciousRecent) k += 1;
  }
  const total = rows.length;
  const measured = coveredCount > 0; // 접속기록 관측 0이면 미측정(무감점)
  return {
    key: 'threat',
    score: measured ? 100 * (1 - P.threatSuspicious) ** k : null,
    measured,
    coveredCount,
    totalCount: total,
    coverage: total === 0 ? 0 : coveredCount / total,
    topFinding: k > 0 ? `이상 접속 정황 ${k}건 — 지금 세션부터 끊어요` : null,
  };
}

// ── 5. 종합 블렌드: (1−λ)×WA + λ×worst, 측정 축만 재정규화 ──
export function blend(axes: AxisScore[]): {
  composite: number | null;
  weakestAxis: AxisKey | null;
  measured: boolean;
} {
  const P = SCORE_V2_PARAMS;
  const measuredAxes = axes.filter((a) => a.measured && a.score !== null);
  if (measuredAxes.length === 0) {
    return { composite: null, weakestAxis: null, measured: false };
  }
  const totalW = measuredAxes.reduce((s, a) => s + P.weights[a.key], 0);
  const wa =
    measuredAxes.reduce((s, a) => s + P.weights[a.key] * (a.score as number), 0) / totalW;
  const worst = Math.min(...measuredAxes.map((a) => a.score as number));

  // weakestAxis: 최저 점수, 동률 시 가중치 큰 축 우선
  let weakest = measuredAxes[0];
  for (const a of measuredAxes) {
    if (
      (a.score as number) < (weakest.score as number) ||
      ((a.score as number) === (weakest.score as number) &&
        P.weights[a.key] > P.weights[weakest.key])
    ) {
      weakest = a;
    }
  }

  const raw = (1 - P.lambda) * wa + P.lambda * worst;
  const composite = Math.max(0, Math.min(100, Math.round(raw)));
  return { composite, weakestAxis: weakest.key, measured: true };
}

export function deriveGrade(score: number): Grade {
  return score >= 80 ? '양호' : score >= 50 ? '주의' : '위험';
}

// ── 4장 전체: rows → 4축 산출 ──
export function computeAxes(rows: ScoreRowV2[]): Record<AxisKey, AxisScore> {
  return {
    exposure: computeExposure(rows),
    surface: computeSurface(rows),
    hygiene: computeHygiene(rows),
    threat: computeThreat(rows),
  };
}

// 종합만 빠르게(시뮬레이션·expectedGain 내부용)
export function computeComposite(rows: ScoreRowV2[]): number | null {
  const axes = computeAxes(rows);
  return blend([axes.exposure, axes.surface, axes.hygiene, axes.threat]).composite;
}

// ── 7·8장 회복 규칙: 액션을 신호에 적용한 가상 rows 반환(순수 transform) ──
// expectedGain·시뮬레이터용. 대상 인덱스 미지정 시 액션별 기본 대상(전체 해당 계정).
export function applyAction(
  rows: ScoreRowV2[],
  actionType: ActionType,
  targetIndices?: number[],
): ScoreRowV2[] {
  const hit = (i: number, r: ScoreRowV2, eligible: boolean) =>
    eligible && (targetIndices ? targetIndices.includes(i) : true);
  return rows.map((r, i) => {
    switch (actionType) {
      case 'password_change':
        return hit(i, r, r.passwordReused && !r.passwordChanged && !r.removed)
          ? { ...r, passwordChanged: true }
          : r;
      case 'resolve_breach':
        return hit(i, r, r.breachedUnresolved && !r.removed)
          ? { ...r, breachedUnresolved: false }
          : r;
      case 'logout_sessions':
        return hit(i, r, r.suspiciousRecent && !r.sessionsCleared && !r.removed)
          ? { ...r, sessionsCleared: true }
          : r;
      case 'enable_2fa':
        return hit(i, r, r.provider === 'manual' && !r.twoFactorEnabled && !r.removed)
          ? { ...r, twoFactorEnabled: true }
          : r;
      case 'delete':
      case 'revoke':
        return hit(i, r, !r.removed) ? { ...r, removed: true } : r;
      default:
        return r;
    }
  });
}

// ── 6.3 expectedGain: composite(rows ⊕ action) − composite(rows), 하한 0 clamp([C2]) ──
function expectedGain(
  rows: ScoreRowV2[],
  base: number | null,
  actionType: ActionType,
  targetIndices: number[],
): number {
  if (base === null || targetIndices.length === 0) return 0;
  const after = computeComposite(applyAction(rows, actionType, targetIndices));
  if (after === null) return 0;
  return Math.max(0, after - base); // 회복은 절대 하락 없음 — 음수 clamp
}

// 액션별 대상 인덱스 산출(활성 계정 한정)
function targetsFor(rows: ScoreRowV2[], actionType: ActionType): number[] {
  const P = SCORE_V2_PARAMS;
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r.removed) return;
    switch (actionType) {
      case 'password_change':
        if (r.passwordReused && !r.passwordChanged) out.push(i);
        break;
      case 'resolve_breach':
        if (r.breachedUnresolved) out.push(i);
        break;
      case 'logout_sessions':
        if (r.suspiciousRecent && !r.sessionsCleared) out.push(i);
        break;
      case 'enable_2fa':
        if (r.provider === 'manual' && !r.twoFactorEnabled) out.push(i);
        break;
      case 'delete':
      case 'revoke':
        // 방치 표면 대상: 휴면·미인지(제거 시 표면 소멸)
        if (isDormant(r) || isStale(r) || r.discovered) out.push(i);
        break;
    }
  });
  return out;
}

// 최약축 → 우선 액션 매핑(SSOT 6.2). [C2] hygiene은 password_change 고정(delete 아님).
const WEAKEST_ACTION: Record<AxisKey, ActionType> = {
  hygiene: 'password_change',
  exposure: 'resolve_breach',
  surface: 'delete',
  threat: 'logout_sessions',
};

// ── 엔진 본체: rows → 종합·4축·최약축·추천액션·expectedGain 목록 ──
export function scoreV2(rows: ScoreRowV2[]): ScoreV2Result {
  const axes = computeAxes(rows);
  const { composite, weakestAxis, measured } = blend([
    axes.exposure,
    axes.surface,
    axes.hygiene,
    axes.threat,
  ]);

  // expectedGain 목록: 데이터에 존재하는 회복 레버별 번들
  const leverTypes: ActionType[] = [
    'password_change',
    'resolve_breach',
    'logout_sessions',
    'delete',
    'enable_2fa',
  ];
  const axisOfLever: Record<ActionType, AxisKey> = {
    password_change: 'hygiene',
    enable_2fa: 'hygiene',
    resolve_breach: 'exposure',
    delete: 'surface',
    revoke: 'surface',
    logout_sessions: 'threat',
  };
  const expectedGains: ExpectedGainItem[] = [];
  for (const lever of leverTypes) {
    const targets = targetsFor(rows, lever);
    if (targets.length === 0) continue;
    expectedGains.push({
      axis: axisOfLever[lever],
      actionType: lever,
      accountIndices: targets,
      expectedGain: expectedGain(rows, composite, lever, targets),
    });
  }

  let recommendedAction: RecommendedAction | null = null;
  if (weakestAxis) {
    const actionType = WEAKEST_ACTION[weakestAxis];
    const targets = targetsFor(rows, actionType);
    if (targets.length > 0) {
      recommendedAction = {
        axis: weakestAxis,
        actionType,
        accountIndices: targets,
        expectedGain: expectedGain(rows, composite, actionType, targets),
      };
    }
  }

  return {
    composite,
    measured,
    grade: composite === null ? null : deriveGrade(composite),
    weakestAxis,
    axes,
    coverage: axes.surface.coverage, // 헤드라인 대표 = surface(SSOT 8장)
    recommendedAction,
    expectedGains,
  };
}
