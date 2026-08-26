// 미측정 축을 화면이 어떻게 다루는지 — 소스 스캔, 자원 불필요.
//
// 실행: pnpm exec tsx scripts/verify-axis-visibility.ts
//
// 왜: 비밀번호 습관 축은 미측정일 때 화면에서 통째로 숨겨져 있었다. 그런데 그 축은 사용자가
// 자가신고로 켤 수 있었다. 숨기는 쪽을 택하는 바람에 **사용자는 그 길이 있다는 것조차 알 수
// 없었고**, 그래서 영영 미측정이었다(2026-08-26 발견).
//
// 같은 미측정인데 처리가 갈리던 것도 문제였다 — 이상 접속 축은 "확인 불가"로 서 있었고
// 비밀번호 습관만 사라졌다. 사용자에게 두 축은 같은 상태인데 화면이 다르게 말했다.
//
// 두 방향을 함께 막는다.
//   되돌아가면 → 축이 다시 숨겨지고 사용자가 켤 길을 잃는다
//   과하게 가면 → 못 재는 것을 잰 척하거나, 답을 강요하는 화면이 된다
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

const DASH = 'app/(app)/dashboard/page.tsx';
const ENGINE = 'lib/score-v2.ts';

function main(): void {
  const src = readFileSync(DASH, 'utf8');

  // ── 숨기지 않는다 ──
  const visible = src.match(/function visibleAxes\([\s\S]*?\n\}/)?.[0] ?? '';
  check(visible.length > 0, '1 visibleAxes를 찾는다');
  // **반환문만** 본다. 시그니처의 타입 표기에도 `measured`가 들어 있어서, 함수 전체를
  // 훑으면 타입 주석을 결함으로 읽는다. 검사가 엉뚱한 것을 잡으면 고칠 곳을 잘못 짚게 된다.
  const ret = visible.match(/return[^;]*;/)?.[0] ?? '';
  check(
    /return\s+AXIS_ORDER\s*;/.test(ret),
    `2 축을 거르지 않고 전부 세운다 — 못 잰다는 사실도 보여줄 값어치가 있다 (${ret.trim()})`,
  );

  // ── 못 재는 축은 이유를 말한다 ──
  const notes = src.match(/const AXIS_UNMEASURED: [\s\S]*?\n\};/)?.[0] ?? '';
  check(/hygiene:/.test(notes), '3 비밀번호 습관 미측정 사유 문장이 있다');
  check(/threat:/.test(notes), '4 이상 접속 미측정 사유 문장이 있다');

  // ── 켤 수 있는 축에만 문을 낸다 ──
  const cta = src.match(/const AXIS_UNMEASURED_CTA: [\s\S]*?\n\};/)?.[0] ?? '';
  check(/hygiene:\s*\{/.test(cta), '5 비밀번호 습관에는 켜러 가는 문이 있다');
  check(
    !/threat:\s*\{/.test(cta),
    '6 이상 접속에는 문을 내지 않는다 — 사용자가 만들어 낼 수 없는 신호다',
  );
  check(
    /!measured && AXIS_UNMEASURED_CTA\[key\]/.test(src),
    '7 그 문은 미측정일 때만 뜬다 — 잰 뒤에도 남으면 잔소리가 된다',
  );

  // ── 못 잰 것을 잰 척하지 않는다 ──
  check(
    /확인 불가/.test(src),
    '8 미측정 축의 점수 자리는 숫자가 아니라 "확인 불가"다',
  );

  // ── 산식은 그대로다 ──
  //   화면에 세운다고 미측정 축이 종합에 끼면, 재지도 않은 축이 점수를 끌어내린다.
  const engine = readFileSync(ENGINE, 'utf8');
  check(
    /measured/.test(engine) && /재정규화|정규화/.test(engine),
    '9 종합은 측정된 축만으로 재정규화한다(엔진 불변)',
  );

  console.log(`verify-axis-visibility: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
