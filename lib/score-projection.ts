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
      passwordSignalObserved: true, // 시드 인벤토리는 전부 수집 경로 있음
      discovered: a.discovered ?? false,
      acknowledged: false, // 시드는 확인 이력 없음 — 앵커 24 보존
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

export type RecoveryProjection = {
  beforeComposite: number | null;
  afterComposite: number | null;
  beforeAxes: Record<AxisKey, AxisScore>;
  afterAxes: Record<AxisKey, AxisScore>;
  axisKeys: AxisKey[];
};

/**
 * 투영 입력. 실사용자 경로는 이걸 채워 넘긴다.
 *  - `rows`: 그 사용자의 실제 계정 신호
 *  - `deleteIdx`: **정리 큐의 미완료 요청** 대상 인덱스. 투영이 말하는 "정리하면"은
 *    사용자가 실제로 담은 것을 완료했을 때를 뜻한다. 큐 밖 계정을 임의로 지우면
 *    투영이 사용자가 하지 않은 일을 전제하게 된다.
 */
export type ProjectionInput = {
  rows: ScoreRowV2[];
  deleteIdx: number[];
};

/** 시드(데모 페르소나) 투영 입력. 삭제 표적은 시드 정리 큐의 미완료 요청에서 파생한다. */
function seedInput(): ProjectionInput {
  const rows = baseRows();
  const deleteIdx = dummyRequests
    .filter((r) => r.status !== '완료') // 완료분은 before에서 이미 removed
    .map((r) => dummyAccounts.findIndex((a) => a.service === r.service))
    .filter((i) => i >= 0);
  return { rows, deleteIdx };
}

/**
 * 회복 투영 — "지금 담아 둔 정리를 끝내면 여기까지 옵니다".
 *
 * 인자를 주면 그 사용자의 실데이터로, 생략하면 시드 페르소나로 계산한다.
 * **인자 없이 호출한 결과를 로그인 사용자 화면에 쓰면 안 된다** — 실제 계정이 몇 개든
 * 항상 같은 숫자가 나와 대시보드와 출발점이 어긋난다(2026-08-04 실측으로 확인된 결함).
 *
 * 표적 선택 원칙
 *  - delete: 정리 큐 미완료분만. 전삭제는 점수를 100 근처로 띄우는 과장이다(07-15 B1).
 *  - password_change·resolve_breach·logout_sessions·enable_2fa: 대상 인덱스를 주지 않는다.
 *    applyAction이 자격 조건(재사용 보유·유출 미해결·이상접속·manual+2FA미설정)으로
 *    스스로 거른다. delete를 먼저 적용하므로 삭제된 계정은 자동 제외된다.
 */
export function projectRecovery(input?: ProjectionInput): RecoveryProjection {
  const { rows: before, deleteIdx } = input ?? seedInput();

  const s1 = applyAction(before, 'password_change'); // 재사용 계정 비밀번호 교체
  const s2 = applyAction(s1, 'resolve_breach'); // 미해결 유출 조치
  const s3 = applyAction(s2, 'logout_sessions'); // 이상 세션 정리
  const s4 = applyAction(s3, 'delete', deleteIdx); // 정리 큐 완료
  const after = applyAction(s4, 'enable_2fa'); // 남은 manual 계정 2FA 설정

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
