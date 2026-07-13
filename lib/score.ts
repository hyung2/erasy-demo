// 프라이버시 점수 산식 — 인터페이스 stub (T1.2).
// 산식·가중치는 W3에서 engine-data가 별도 기획하여 확정한다. 여기서는 시그니처만 고정.
// 확정 전까지 computePrivacyScore를 호출하면 안 되며(런타임 throw로 오사용 차단),
// 데모 표시값은 lib/dummy-data.ts의 derivePrivacyScore를 계속 사용한다.

// 점수 입력 신호 — Account 컬럼/관계에서 파생(전부 자격증명과 무관한 메타 신호).
export type ScoreSignals = {
  totalAccounts: number; // 총 연결 계정 수
  breachedCount: number; // 유출 노출 계정 수
  reusedCount: number; // 비밀번호 재사용 계정 수(passwordReused)
  dormantCount: number; // 장기 휴면 계정 수(lastUsedAt 파생)
  no2faCount: number; // 2FA 미설정 계정 수(!twoFactorEnabled)
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

// W3 확정 대기: 가중치·상한/하한·커버리지 반영 방식 미정.
// engine-data 산식 SSOT 확정 후 본 함수 본문을 구현한다. (산식 확정 금지 — T1.2)
export function computePrivacyScore(
  _signals: ScoreSignals,
  _coverage: ScoreCoverage,
): number {
  throw new Error(
    'computePrivacyScore: 산식 미확정(W3 engine-data 기획 대기). 데모는 dummy-data.derivePrivacyScore 사용.',
  );
}
