// 탈퇴 검증 — 정말 전부 지워지는지 실측한다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/verify-account-deletion.ts
//
// 왜 실측인가: 삭제 코드는 User 한 행만 지우고 나머지를 FK cascade에 맡긴다. 그 위임이
// 맞는지는 스키마를 읽어서가 아니라 **지워 보고 세어 봐야** 안다. cascade가 한 테이블에서
// 빠져 있어도 코드는 성공을 돌려주고, 남은 개인정보는 아무도 모른다.
//
// 안전: 이 스크립트가 만드는 사용자만 지운다. 실제 사용자 id는 절대 delete에 들어가지 않는다.
import { PrismaClient } from '@prisma/client';
import {
  summarizeUserData,
  deleteUserAccount,
  confirmationMatches,
} from '../lib/account-deletion';

const prisma = new PrismaClient();

// 이 접두사가 붙은 사용자만 지운다. 지우기 직전에 한 번 더 대조한다.
const FIXTURE_PREFIX = 'verify-deletion-';

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

/** 자식 테이블을 전부 채운 시험용 사용자. 비어 있으면 cascade를 재도 아무것도 재지 못한다. */
async function createFixtureUser(): Promise<string> {
  const id = `${FIXTURE_PREFIX}${Date.now()}`;
  await prisma.user.create({
    data: {
      id,
      email: `${id}@example.invalid`,
      name: '탈퇴 검증용',
      breachCheckedAt: new Date(),
    },
  });

  const account = await prisma.account.create({
    data: {
      userId: id,
      name: 'ExampleService',
      category: 'overseas',
      provider: 'manual',
      source: 'user_input',
      lastUsedAt: new Date(),
      breached: true,
    },
  });

  await prisma.accessLog.create({
    data: {
      accountId: account.id,
      timestamp: new Date(),
      location: '검증, KR',
      device: '검증 러너',
    },
  });
  await prisma.breach.create({
    data: {
      userId: id,
      accountId: account.id,
      service: 'ExampleService',
      breachDate: new Date('2020-01-01'),
      exposedFields: ['이메일'],
      advice: '검증용',
      severity: 'low',
    },
  });
  await prisma.cleanupRequest.create({
    data: { userId: id, accountId: account.id, actionType: 'revoke', status: 'queued' },
  });
  await prisma.alert.create({
    data: { userId: id, type: 'breach', message: '검증용', triggeredAt: new Date() },
  });
  await prisma.scoreSnapshot.create({
    data: { userId: id, score: 50, coverage: 1, coveredCount: 1 },
  });

  return id;
}

/** 그 사용자 이름으로 남아 있는 행이 몇 개인가. 0이어야 한다. */
async function countResidue(userId: string) {
  const [user, accounts, breaches, cleanupRequests, alerts, scoreSnapshots, accessLogs] =
    await Promise.all([
      prisma.user.count({ where: { id: userId } }),
      prisma.account.count({ where: { userId } }),
      prisma.breach.count({ where: { userId } }),
      prisma.cleanupRequest.count({ where: { userId } }),
      prisma.alert.count({ where: { userId } }),
      prisma.scoreSnapshot.count({ where: { userId } }),
      prisma.accessLog.count({ where: { account: { userId } } }),
    ]);
  return { user, accounts, breaches, cleanupRequests, alerts, scoreSnapshots, accessLogs };
}

async function main() {
  // ── 확인 문구 대조 ──
  check(confirmationMatches('a@b.com', 'a@b.com'), '1 같은 이메일은 통과한다');
  check(confirmationMatches('  A@B.COM  ', 'a@b.com'), '2 대소문자·공백 차이는 봐준다');
  check(!confirmationMatches('a@b.co', 'a@b.com'), '3 다른 문자열은 막는다');
  check(!confirmationMatches('', 'a@b.com'), '4 빈 문구는 막는다');
  check(!confirmationMatches('삭제', 'a@b.com'), '5 임의의 단어로는 통과하지 못한다');

  // ── 실제 삭제 ──
  const userId = await createFixtureUser();
  const before = await countResidue(userId);
  console.log(`시험 사용자 생성: ${userId}`);
  console.log(`  삽입 ${JSON.stringify(before)}`);

  check(before.user === 1, '6 시험 사용자가 만들어졌다');
  check(
    before.accounts === 1 &&
      before.breaches === 1 &&
      before.cleanupRequests === 1 &&
      before.alerts === 1 &&
      before.scoreSnapshots === 1 &&
      before.accessLogs === 1,
    '7 자식 테이블 6종이 모두 채워졌다(빈 상태로 cascade를 재는 헛검증 방지)',
  );

  const summary = await summarizeUserData(userId);
  check(summary !== null, '8 보관 현황을 읽을 수 있다');
  check(summary?.accounts === 1, '9 현황의 계정 수가 실제와 같다');
  check(summary?.accessLogs === 1, '10 현황이 접속기록까지 센다(Account 경유 자식)');

  if (!userId.startsWith(FIXTURE_PREFIX)) {
    throw new Error('안전장치: 시험용이 아닌 id를 지우려 했습니다.');
  }
  const result = await deleteUserAccount(userId);
  check(result !== null, '11 삭제가 수행됐다');
  check(result?.deleted.accounts === 1, '12 삭제 결과가 지운 양을 보고한다');

  const after = await countResidue(userId);
  console.log(`  잔여 ${JSON.stringify(after)}`);
  check(after.user === 0, '13 User가 남지 않는다');
  check(after.accounts === 0, '14 계정 목록이 남지 않는다');
  check(after.accessLogs === 0, '15 접속기록이 남지 않는다(Account 경유 2단 cascade)');
  check(after.breaches === 0, '16 유출 이력이 남지 않는다');
  check(after.cleanupRequests === 0, '17 정리 요청이 남지 않는다');
  check(after.alerts === 0, '18 알림이 남지 않는다');
  check(after.scoreSnapshots === 0, '19 진단 이력이 남지 않는다');

  // 이미 없는 사용자를 다시 지워도 던지지 않아야 한다(중복 요청·새로고침).
  const again = await deleteUserAccount(userId);
  check(again === null, '20 없는 사용자 삭제는 null로 수렴한다(500이 아니라)');

  console.log(`verify-account-deletion: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
