// 회복 투영(순수) — 결과 화면 Before/After 데모 클라이맥스용.
//  score-v2 순수 함수만 import(엔진·서비스 미수정). 시드 신호(dummy-data)에 회복 레버를 전부 적용해
//  "정리하면 이렇게 오른다"를 엔진으로 실제 계산한다(하드코딩 아님·예상 시나리오).
//  주: 실 API(/api/score)가 없거나 로그인 세션이 시드 폴백일 때의 데모 투영. 라벨은 "예상 도달".
import {
  applyAction,
  computeAxes,
  blend,
  type ScoreRowV2,
  type AxisKey,
  type AxisScore,
} from './score-v2';
import {
  accounts as dummyAccounts,
  breaches as dummyBreaches,
  deleteRequests as dummyRequests,
} from './dummy-data';

const AXIS_KEYS: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];

// 시드 신호 → 엔진 입력 행(score-service memoryRowsV2와 동일 매핑. AccessLog 없음 → T 미측정).
function baseRows(): ScoreRowV2[] {
  return dummyAccounts.map((a) => {
    const b =
      dummyBreaches.find((x) => x.service === a.service && !x.resolved) ?? null;
    const removed = dummyRequests.some(
      (r) => r.service === a.service && r.status === '완료',
    );
    return {
      provider:
        a.linkMethod === 'email-password'
          ? ('manual' as const)
          : (a.linkMethod.replace('-oauth', '') as ScoreRowV2['provider']),
      category: a.category,
      lastUsedDays: a.lastUsedDays,
      twoFactorEnabled: a.twoFactorEnabled ?? false,
      passwordReused: a.passwordReused ?? false,
      discovered: a.discovered ?? false,
      breachedUnresolved: b !== null,
      breachedPasswordExposed: b?.exposedFields.includes('비밀번호') ?? false,
      suspiciousRecent: false,
      accessLogObserved: false,
      removed,
      passwordChanged: false,
      sessionsCleared: false,
    };
  });
}

function composite(axes: Record<AxisKey, AxisScore>): number | null {
  return blend([axes.exposure, axes.surface, axes.hygiene, axes.threat]).composite;
}

export type RecoveryProjection = {
  beforeComposite: number | null;
  afterComposite: number | null;
  beforeAxes: Record<AxisKey, AxisScore>;
  afterAxes: Record<AxisKey, AxisScore>;
  axisKeys: AxisKey[];
};

// 회복 레버 전부 적용(유출 조치·비번 교체·2FA·세션 정리·방치 계정 제거) → 예상 도달 상태.
export function projectRecovery(): RecoveryProjection {
  const before = baseRows();
  let after = before;
  const levers = [
    'resolve_breach',
    'password_change',
    'enable_2fa',
    'logout_sessions',
    'delete',
  ] as const;
  for (const lever of levers) {
    after = applyAction(after, lever);
  }
  const beforeAxes = computeAxes(before);
  const afterAxes = computeAxes(after);
  return {
    beforeComposite: composite(beforeAxes),
    afterComposite: composite(afterAxes),
    beforeAxes,
    afterAxes,
    axisKeys: AXIS_KEYS,
  };
}
