// 자가신고 저장이 사용자가 고르지 않은 값을 보내지 않는지 — 소스 스캔, DB·서버 불필요.
//
// 실행: pnpm exec tsx scripts/verify-selfreport-payload.ts
//
// 왜 소스를 보는가: 이 결함은 서버가 아니라 화면에 있다. 서버는 받은 대로 저장할 뿐이고,
// 잘못된 값을 만들어 보내는 쪽이 클라이언트다. 런타임으로 잡으려면 브라우저를 띄워야 하는데,
// 그 비용을 매번 치르면 결국 안 돌리게 된다.
//
// 무엇이 문제였나: 사용일 버킷은 거친 값이다(1년 이내 → 180일). 폼은 이미 관측된 날짜에서
// 버킷을 역산해 채워 두는데, 사용자가 그 항목을 건드리지 않고 저장해도 버킷이 그대로
// 전송돼 서버가 대푯값을 날짜로 환산해 덮었다. "5일 전"으로 관측된 계정이 "180일 전"이 된다.
// 사용자가 말하지 않은 값이 기록되고, 측정해 둔 정밀도가 사라진다(2026-08-26).
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

const SRC = 'app/(app)/scan/page.tsx';

function main(): void {
  const src = readFileSync(SRC, 'utf8');

  // payload 리터럴 안에 lastUsedBucket이 무조건 들어가 있으면 안 된다.
  const payloadBlock = src.match(/const payload: AccountUpdateRequest = \{[\s\S]*?\};/)?.[0] ?? '';
  check(payloadBlock.length > 0, '1 자가신고 payload 리터럴을 찾는다');
  check(
    !/lastUsedBucket\s*:/.test(payloadBlock),
    '2 payload 리터럴이 사용일을 무조건 담지 않는다 — 고른 적 없는 값을 저장하지 않는다',
  );

  // 대신 "바뀌었을 때만" 담는 분기가 있어야 한다. 빼기만 하면 사용자가 실제로 고쳐도 안 담긴다.
  check(
    /formInitial[\s\S]{0,120}lastUsedBucket\s*!==[\s\S]{0,120}payload\.lastUsedBucket\s*=/.test(src),
    '3 사용자가 사용일을 바꿨을 때는 담는다',
  );

  // 연 시점 값을 붙잡아 두지 않으면 "바뀌었는지"를 알 수 없다.
  check(/setFormInitial\(/.test(src), '4 모달을 연 시점의 값을 보관한다');
  check(
    (src.match(/setFormInitial\(null\)/g) ?? []).length >= 1,
    '5 저장 후 보관값을 비운다 — 다음 계정에 이전 값이 새지 않는다',
  );

  // 위생 두 신호는 항상 보낸다. 안 보내면 "아니오·아니오"가 신고로 기록되지 않는다.
  check(
    /passwordReused:\s*form\.passwordReused/.test(payloadBlock) &&
      /twoFactorEnabled:\s*form\.twoFactorEnabled/.test(payloadBlock),
    '6 재사용·2FA는 값과 무관하게 항상 보낸다 — 이것이 신고 행위의 근거다',
  );

  console.log(`verify-selfreport-payload: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
