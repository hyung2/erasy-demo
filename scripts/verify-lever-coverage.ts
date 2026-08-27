// 점수를 깎는 인자마다 그것을 해소하는 길이 화면에 있는지 — 소스 스캔, 자원 불필요.
//
// 실행: pnpm exec tsx scripts/verify-lever-coverage.ts
//
// 왜: 2026-08-27에 P0 두 건이 **가드 451건 전량 통과 상태에서** 나왔다.
//
//   (1) 노출면 축의 최대 감점 인자는 "미인지"(discovered ∧ ¬acknowledged)였는데 그것을
//       해소하는 레버가 엔진에 없었다. 무대 계정은 209건을 확인하기만 해도 28 → 64인데,
//       화면에는 그 문이 없었다.
//   (2) "방치 계정 정리하기"의 대상이 `isDormant || isStale || discovered`였다. 실제 방치는
//       11건인데 265건 전부를 정리하라고 권했다. 확인으로 사라지는 것을 삭제 대상으로 센 것이다.
//
// 기존 `verify-axis-visibility`는 **미측정 축만** 본다. 측정됐지만 해소할 길이 없거나 길이
// 엉뚱한 곳을 가리키는 경우는 검사 범위 밖이었다. 그래서 이 가드를 따로 둔다.
//
// 여기서 지키는 것은 세 가지다.
//   A. 감점 인자마다 그것을 되돌리는 레버가 있다
//   B. 레버의 대상 판정이 그 인자와 일치한다 — 다른 것으로 번지지 않는다
//   C. 그 레버로 가는 문이 화면에 있고, 우선순위가 하나로 정해진다
//
// 그리고 흐름이 끊기지 않는지도 함께 본다 — 정리 화면에서 유출 조회로 가는 다리.
import { readFileSync } from 'node:fs';

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

const ENGINE = 'lib/score-v2.ts';
const DASH = 'app/(app)/dashboard/page.tsx';
const SCAN = 'app/(app)/scan/page.tsx';
const CLEANUP = 'app/(app)/cleanup/page.tsx';

/** 주석을 걷어낸 소스. 이 가드는 동작을 검사하므로 설명 문장은 보면 안 된다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function main(): void {
  const engine = stripComments(readFileSync(ENGINE, 'utf8'));
  const dash = stripComments(readFileSync(DASH, 'utf8'));
  const scan = stripComments(readFileSync(SCAN, 'utf8'));
  const cleanup = stripComments(readFileSync(CLEANUP, 'utf8'));

  // ── A. 감점 인자마다 레버가 있다 ──
  //   노출면 축이 깎는 것은 둘이다: 방치(휴면·묵음)와 미인지. 각각 되돌리는 길이 있어야 한다.
  check(
    /'acknowledge'/.test(engine),
    'A1 미인지를 해소하는 레버(acknowledge)가 엔진에 있다 — 없으면 확인해도 점수가 그대로다',
  );
  const levers = engine.match(/const leverTypes:[\s\S]*?\];/)?.[0] ?? '';
  check(levers.length > 0, 'A2 회복 레버 목록을 찾는다');
  check(
    /'acknowledge'/.test(levers),
    'A3 확인이 기대 상승 목록에 든다 — 빠지면 화면 추천에 나타날 길이 없다',
  );
  const axisMap = engine.match(/const axisOfLever:[\s\S]*?\};/)?.[0] ?? '';
  check(
    /acknowledge:\s*'surface'/.test(axisMap),
    'A4 확인이 노출면 축의 레버로 분류된다 — 감점한 축과 회복시키는 축이 같아야 한다',
  );

  // ── B. 레버의 대상 판정이 그 인자와 일치한다 ──
  //   삭제는 "방치"를 되돌리는 레버다. 확인으로 사라지는 것(discovered)까지 대상에 넣으면
  //   화면이 "265개를 지우라"고 말하게 된다. 실제 방치는 11건이었다.
  const targets = engine.match(/function targetsFor\([\s\S]*?\n\}/)?.[0] ?? '';
  check(targets.length > 0, 'B1 대상 판정 함수를 찾는다');
  const deleteCase =
    targets.match(/case 'delete':[\s\S]*?break;/)?.[0] ?? '';
  check(deleteCase.length > 0, 'B2 삭제 대상 분기를 찾는다');
  check(
    !/r\.discovered/.test(deleteCase),
    'B3 발견됐다는 이유만으로 삭제 대상이 되지 않는다 — 그건 확인으로 해소되는 상태다',
  );
  check(
    /isDormant\(r\)/.test(deleteCase) && /isStale\(r\)/.test(deleteCase),
    'B4 삭제 대상은 휴면·묵은 계정이다',
  );
  const ackCase = targets.match(/case 'acknowledge':[\s\S]*?break;/)?.[0] ?? '';
  check(
    /r\.discovered/.test(ackCase) && /!r\.acknowledged/.test(ackCase),
    'B5 확인 대상은 아직 확인하지 않은 발견 계정이다 — 엔진 감점 조건과 같은 식',
  );

  // ── C. 그 레버로 가는 문이 화면에 있다 ──
  check(
    /acknowledge:\s*\{\s*label:/.test(dash),
    'C1 대시보드 추천 액션이 확인 카드를 그릴 수 있다',
  );
  check(
    /acknowledge:\s*\{[^}]*href:\s*'\/scan'/.test(dash),
    'C2 확인 카드가 목록 화면으로 보낸다 — 확인 API가 "목록을 본 시점"을 전제한다',
  );
  //   대시보드 카드는 상위 3개만 보여준다. 메일 스캔을 하지 않은 사람도 확인할 수 있어야 하므로
  //   목록 화면 자체에 상시 경로가 있어야 한다.
  check(
    /\/api\/accounts\/acknowledge/.test(scan),
    'C3 계정 목록 화면에서 바로 확인할 수 있다 — 예전에는 메일 스캔 결과 패널 안에만 있었다',
  );
  check(
    /discovered\s*&&\s*!a\.acknowledged/.test(scan),
    'C4 목록 화면이 미확인 건수를 스스로 센다',
  );

  //   우선순위는 하나다. 최약축 액션이 둘 이상일 때 배지가 전부에 붙으면 무엇부터인지를
  //   말하지 않는 것과 같다.
  check(
    /const primaryAction\s*=/.test(dash),
    'C5 우선 조치를 하나로 고르는 자리가 있다',
  );
  check(
    !/isPrimary\s*=\s*rec\.axis\s*===\s*weakestAxis/.test(dash),
    'C6 우선 조치 배지가 축이 아니라 액션 하나에 붙는다',
  );
  //   상승폭 0인 액션이 "점수가 오릅니다"라고 말하면 안 된다.
  check(
    /gain > 0\s*\n?\s*\?/.test(dash) || /gain > 0 \?/.test(dash),
    'C7 상승폭이 0일 때 오른다고 말하지 않는다',
  );

  // ── D. 흐름이 끊기지 않는다 — 정리 → 유출 조회 ──
  const bridge = cleanup.match(/cleanup-discovery[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  check(bridge.length > 0, 'D1 정리 화면의 유출 조회 다리를 찾는다');
  check(
    /href="\/breach"/.test(bridge),
    'D2 자체 유출 조회로 가는 걸음이 있다 — 남의 사이트로만 내보내면 흐름이 거기서 끝난다',
  );
  check(
    !/정리 전/.test(bridge),
    'D3 "정리 전"이라 말하지 않는다 — 유출 조회는 정리를 접수한 사람만의 것이 아니다',
  );

  console.log(`verify-lever-coverage: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
