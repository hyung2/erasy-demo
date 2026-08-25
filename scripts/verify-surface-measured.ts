// S축(방치 표면)이 "잴 근거가 있는데도 미측정으로 빠지는" 경우를 막는다 — 순수 함수, DB 불필요.
//
// 실행: pnpm exec tsx scripts/verify-surface-measured.ts
//
// 왜: S축은 오랫동안 `사용 이력이 확인된 계정 > 0`일 때만 측정으로 쳤다. 그런데 소셜 연결
// 목록은 플랫폼이 마지막 사용 시각을 주지 않는다. 그래서 그 입력만 가진 사용자는 몰랐던
// 계정을 아무리 많이 찾아 줘도 축이 통째로 미측정으로 빠졌고, 위험 신호가 있는 사용자와
// 아무 신호도 없는 사용자가 똑같이 0점으로 나왔다(2026-08-25 실측).
//
// "몰랐던 계정을 찾아 준다"가 이 제품의 핵심 주장이다. 그 관측이 점수에서 사라지면
// 제품이 하는 말과 제품이 재는 값이 갈라진다.
//
// 반대 방향도 함께 막는다 — 근거가 정말 하나도 없으면 미측정이어야 한다. 넓히다가
// "모르는 것도 일단 재고 본다"로 가면 08-21·08-25에 고친 것들이 되돌아온다.
import { computeSurface, type ScoreRowV2 } from '../lib/score-v2';

export {};

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

/**
 * 아무 신호도 없는 기준 행. **`as ScoreRowV2` 캐스팅을 쓰지 않는다.**
 *
 * 캐스팅을 쓰면 필드가 빠져도 타입 검사가 통과하고, 엔진은 undefined를 받아 조용히 다른
 * 값을 낸다. 같은 실수로 확인 효과를 84점이라 잘못 보고한 적이 있다(2026-08-25).
 * 여기서는 전 필드를 명시해 스키마가 바뀌면 이 파일이 먼저 깨지게 둔다.
 */
function row(over: Partial<ScoreRowV2>): ScoreRowV2 {
  return {
    provider: 'manual',
    category: 'domestic',
    lastUsedDays: null,
    twoFactorEnabled: false,
    passwordReused: false,
    passwordSignalObserved: false,
    discovered: false,
    acknowledged: false,
    breachedUnresolved: false,
    breachedPasswordExposed: false,
    suspiciousRecent: false,
    accessLogObserved: false,
    removed: false,
    passwordChanged: false,
    sessionsCleared: false,
    ...over,
  };
}

function main(): void {
  // ── 근거가 있으면 잰다 ──
  const onlyDiscovered = computeSurface([
    row({ discovered: true }),
    row({ discovered: true }),
    row({}),
  ]);
  check(onlyDiscovered.measured, '1 사용 이력이 전부 미상이어도 미인지 계정이 있으면 측정한다');
  check(
    onlyDiscovered.score !== null && onlyDiscovered.score < 100,
    `2 미인지 계정이 점수를 실제로 끌어내린다 (score=${onlyDiscovered.score})`,
  );
  check(
    (onlyDiscovered.topFinding ?? '').includes('몰랐던 계정 2개'),
    `3 근거가 문장으로 드러난다 (${onlyDiscovered.topFinding})`,
  );

  const onlyDates = computeSurface([row({ lastUsedDays: 800 }), row({ lastUsedDays: 10 })]);
  check(onlyDates.measured, '4 미인지 계정이 없어도 사용 이력이 있으면 측정한다');

  // ── 근거가 없으면 재지 않는다 ──
  const nothing = computeSurface([row({}), row({}), row({})]);
  check(
    !nothing.measured && nothing.score === null,
    `5 근거가 하나도 없으면 미측정이고 점수는 null (measured=${nothing.measured}, score=${nothing.score})`,
  );
  check(computeSurface([]).measured === false, '6 계정이 0건이면 미측정');

  // ── 확인(acknowledge)은 근거를 소멸시키지 않는다 ──
  //   확인은 "모르고 있다"는 상태를 해소하는 것이지 계정을 없애는 것이 아니다.
  //   확인했다는 이유로 축이 미측정으로 빠지면, 사용자가 성실하게 확인할수록 점수가
  //   사라지는 이상한 제품이 된다.
  const acked = computeSurface([
    row({ discovered: true, acknowledged: true }),
    row({ discovered: true, acknowledged: true }),
  ]);
  check(
    acked.score === null || acked.score === 100,
    `7 전부 확인하면 미인지 감점이 사라진다 (score=${acked.score})`,
  );

  // ── 신호 있는 사용자와 없는 사용자가 구분된다 ──
  //   이 결함의 사용자 체감이 바로 이것이었다. 둘 다 0점이면 점수가 아무 말도 하지 않는다.
  const risky = computeSurface([row({ discovered: true }), row({ discovered: true })]);
  const clean = computeSurface([row({ lastUsedDays: 5 }), row({ lastUsedDays: 5 })]);
  check(
    risky.measured && clean.measured && (risky.score ?? 0) < (clean.score ?? 0),
    `8 위험 신호가 있는 쪽이 더 낮다 (위험=${risky.score} · 정상=${clean.score})`,
  );

  // ── coverage 분자는 넓히지 않는다 ──
  //   그 수는 "사용 이력을 확인한 계정"이라는 뜻이다. 미인지 계정을 거기 섞으면
  //   확인하지 않은 것을 확인했다고 말하게 된다.
  check(
    onlyDiscovered.coveredCount === 0,
    `9 미인지 계정은 사용이력 coverage에 섞이지 않는다 (covered=${onlyDiscovered.coveredCount})`,
  );
  check(
    onlyDates.coveredCount === 2,
    `10 사용 이력이 있는 계정만 coverage 분자에 든다 (covered=${onlyDates.coveredCount})`,
  );

  console.log(`verify-surface-measured: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
