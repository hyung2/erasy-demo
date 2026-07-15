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

// 시드 → 엔진 입력 행. fixture(score-v2-fixture.test.ts)·DB 경로와 동일하게 T축 관측 세팅.
//   앵커 24 정합의 핵심: 접속기록 관측 5/24 + 이상접속 뽐뿌(a17). 이걸 빼면 T 미측정 → before=22로 어긋남.
const SUSPICIOUS = new Set(['a17']);
const ACCESS_OBSERVED = new Set(['a17', 'a01', 'a05', 'a08', 'a19']); // 5/24

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
      suspiciousRecent: SUSPICIOUS.has(a.id),
      accessLogObserved: ACCESS_OBSERVED.has(a.id),
      removed,
      passwordChanged: false,
      sessionsCleared: false,
    };
  });
}

function composite(axes: Record<AxisKey, AxisScore>): number | null {
  return blend([axes.exposure, axes.surface, axes.hygiene, axes.threat]).composite;
}

const idxOf = (id: string) => dummyAccounts.findIndex((a) => a.id === id);

export type RecoveryProjection = {
  beforeComposite: number | null;
  afterComposite: number | null;
  beforeAxes: Record<AxisKey, AxisScore>;
  afterAxes: Record<AxisKey, AxisScore>;
  axisKeys: AxisKey[];
};

// 회복 투영 = fixture 회복 계단(워크스루 12.5)과 동일 순서·타깃 → before 24, after 93(계단 최종).
//   delete는 전삭제가 아니라 방치·미인지 대상만(Quora·뽐뿌·Medium·카카오스토리), 2FA는 Amazon·인터파크.
//   앵커·계단이 fixture로 검증된 값이라, 투영은 그 궤적을 그대로 재현(하드코딩 아닌 SSOT 궤적 승계).
export function projectRecovery(): RecoveryProjection {
  const before = baseRows();
  const s1 = applyAction(before, 'password_change'); // 재사용 6계정 교체
  const s2 = applyAction(s1, 'resolve_breach'); // 유출 3건 해결
  const s3 = applyAction(s2, 'logout_sessions'); // 이상 세션 정리
  const s4 = applyAction(s3, 'delete', [
    idxOf('a15'),
    idxOf('a17'),
    idxOf('a14'),
    idxOf('a07'),
  ]); // 방치·미인지 제거
  const after = applyAction(s4, 'enable_2fa', [idxOf('a12'), idxOf('a16')]); // 2FA 설정

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
