// 런타임 실측 — 세션은 살아 있는데 User 행이 없는 상태의 방어 확인.
// 실행: pnpm exec tsx scripts/verify-session-guard.ts
//
// 재현하려는 사고: JWT 세션은 서버 상태를 보지 않으므로, DB에서 User가 사라져도(테스트 계정
// 정리 등) 쿠키는 유효하다. 그 상태로 Account를 insert하면 `Account_userId_fkey`에 걸린다.
// 2026-07-28 실계정 Gmail 스캔이 이 경로로 502를 냈다.
//
// 검증 항목
//   (a) 존재하는 User → userExists true
//   (b) 없는 User → userExists false (게이트가 여기서 막아야 한다)
//   (c) 게이트 없이 insert하면 실제로 FK 위반이 난다 — 방어의 필요성을 사실로 고정
import { prisma } from '../lib/prisma';
import { userExists } from '../lib/session-user';

const TEST_USER_ID = 'verify-session-guard-tmp';
const GHOST_USER_ID = 'verify-session-guard-ghost'; // DB에 만들지 않는 id

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { userId: { in: [TEST_USER_ID, GHOST_USER_ID] } } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function main() {
  await cleanup();
  await prisma.user.create({
    data: { id: TEST_USER_ID, email: `${TEST_USER_ID}@example.invalid`, name: 'verify' },
  });

  check('a  실재 User 확인', (await userExists(TEST_USER_ID)) === true, TEST_USER_ID);
  check('b  부재 User 확인', (await userExists(GHOST_USER_ID)) === false, GHOST_USER_ID);

  // (c) 게이트를 통과시키지 않고 insert하면 어떤 일이 나는지 사실로 남긴다.
  let fkViolation = false;
  let message = '';
  try {
    await prisma.account.create({
      data: {
        userId: GHOST_USER_ID,
        name: '게이트 없이 삽입',
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
      },
    });
  } catch (e) {
    message = (e as Error).message;
    fkViolation = message.includes('Account_userId_fkey') || message.includes('Foreign key');
  }
  check(
    'c  게이트 없으면 FK 위반',
    fkViolation,
    fkViolation ? 'Account_userId_fkey 위반 재현됨(방어 필요 확인)' : `예외 없음 또는 다른 오류: ${message.slice(0, 80)}`,
  );

  console.log(failures === 0 ? '\n결과: 전 항목 PASS' : `\n결과: ${failures}건 FAIL`);
}

main()
  .catch((e) => {
    console.error('실행 실패:', (e as Error).message);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
