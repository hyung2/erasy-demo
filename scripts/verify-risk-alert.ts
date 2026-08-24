// 위험 알림 모달 기준 검증 — 순수 함수, DB 불필요.
//
// 실행: pnpm exec tsx scripts/verify-risk-alert.ts
//
// 왜: 모달은 흐름을 끊는 개입이다. 이전에는 위험 계정이 **1개만 있어도** 떴다. 0건일 때
// 뜨던 것은 08-18에 고쳤지만 "있으면 뜬다"에서 멈춰 있었고, "많으면 뜬다"가 아니었다.
//
// 임계값을 바꾸면 이 검증이 먼저 깨진다 — 숫자를 조용히 낮춰 모달을 다시 흔하게 만드는
// 변경을 막는다.
import { shouldAlertRisk } from '../lib/risk-alert';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

function main() {
  // ── 뜨지 않아야 하는 경우 ──
  check(!shouldAlertRisk(0, 0), '1 계정이 없으면 뜨지 않는다(0으로 나누지 않는다)');
  check(!shouldAlertRisk(0, 265), '2 위험 0건이면 뜨지 않는다');
  check(!shouldAlertRisk(1, 24), '3 위험 1건에는 뜨지 않는다 — 이번에 좁힌 자리');
  check(!shouldAlertRisk(4, 24), '4 24개 중 4개(17%)는 뜨지 않는다');
  check(!shouldAlertRisk(9, 20), '5 개수가 기준 미만이면 비율이 높아도 뜨지 않는다 (9/20=45%)');
  check(!shouldAlertRisk(20, 300), '6 비율이 낮으면 개수가 많아도 뜨지 않는다 (20/300=6.7%)');
  check(!shouldAlertRisk(2, 3), '7 계정 3개 중 2개(67%)는 뜨지 않는다 — 목록에서 이미 보인다');

  // ── 떠야 하는 경우 ──
  check(shouldAlertRisk(205, 265), '8 실계정 205/265(77%)는 뜬다');
  check(shouldAlertRisk(10, 50), '9 경계: 10개·20%면 뜬다');
  check(shouldAlertRisk(12, 20), '10 20개 중 12개(60%)는 뜬다');

  // ── 경계 ──
  check(!shouldAlertRisk(9, 45), '11 개수 경계 바로 아래(9개)는 뜨지 않는다');
  check(!shouldAlertRisk(10, 51), '12 비율 경계 바로 아래(19.6%)는 뜨지 않는다');

  // ── 기준이 조용히 느슨해지지 않았는가 ──
  //   "있으면 뜬다"로 되돌아가면 아래 둘 중 하나가 반드시 깨진다.
  check(!shouldAlertRisk(1, 1), '13 계정 1개가 전부 위험이어도 뜨지 않는다(100%지만 1건)');
  check(!shouldAlertRisk(5, 10), '14 10개 중 5개(50%)도 개수 미달이면 뜨지 않는다');

  console.log(`verify-risk-alert: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
