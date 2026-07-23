// 런타임 실측 — B2 프로비저닝(lib/provision-demo) 회귀 가드. 실제 DB 대상.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-provision.ts
//
// 검증 항목
//   (a) 임시 사용자 프로비저닝 → 계정 24 · 유출 4 · 접속기록 5 · 정리요청 4 · 스냅샷 2
//   (b) 이력 스냅샷 axes 채워짐(axes null = v1 잔재 재유입 → FAIL)
//   (c) 멱등 — 재실행 시 skip이고 레코드 수 불변
//   (d) 점수 경로 정합 — 프로비저닝 사용자가 시드 유저와 동일 종합/4축 산출(폴백 없이 fallback='none')
//   (e) 쓰기 경로 — 자가신고 PATCH가 겨냥하는 소유권 검증(userId 스코프 조회)이 통과
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유).
// 시크릿 미출력(카운트·점수만).
import { prisma } from '../lib/prisma';
import { provisionDemoData, purgeProvisionedData } from '../lib/provision-demo';
import { getScoreForUser } from '../lib/score-service';
import { accounts as dummyAccounts, breaches as dummyBreaches, deleteRequests } from '../lib/dummy-data';
import type { AxisKey } from '../lib/score-v2';

const AXES: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];

// 실 google sub와 충돌하지 않는 임시 id(숫자 sub와 형태가 다름).
const TEST_USER_ID = 'verify-provision-tmp';
const TEST_PREFIX = `u${TEST_USER_ID}`;

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

async function counts(userId: string) {
  const [accounts, breaches, accessLogs, cleanups, snapshots] = await Promise.all([
    prisma.account.count({ where: { userId } }),
    prisma.breach.count({ where: { userId } }),
    prisma.accessLog.count({ where: { account: { userId } } }),
    prisma.cleanupRequest.count({ where: { userId } }),
    prisma.scoreSnapshot.count({ where: { userId } }),
  ]);
  return { accounts, breaches, accessLogs, cleanups, snapshots };
}

async function main() {
  // 선행 정리(이전 실패 잔재)
  await purgeProvisionedData(prisma, TEST_USER_ID);
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });

  await prisma.user.create({
    data: { id: TEST_USER_ID, email: `${TEST_USER_ID}@example.invalid`, name: 'verify' },
  });

  // (a) 최초 프로비저닝
  const first = await provisionDemoData(prisma, TEST_USER_ID, { idPrefix: TEST_PREFIX });
  const c1 = await counts(TEST_USER_ID);
  const expected = {
    accounts: dummyAccounts.length,
    breaches: dummyBreaches.length,
    accessLogs: 5,
    cleanups: deleteRequests.length,
    snapshots: 2,
  };
  check('a1 프로비저닝 실행', first.provisioned, `provisioned=${first.provisioned}`);
  check(
    'a2 레코드 수',
    c1.accounts === expected.accounts &&
      c1.breaches === expected.breaches &&
      c1.accessLogs === expected.accessLogs &&
      c1.cleanups === expected.cleanups &&
      c1.snapshots === expected.snapshots,
    `${JSON.stringify(c1)} (기대 ${JSON.stringify(expected)})`,
  );

  // (b) 이력 스냅샷 axes 채워짐
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { userId: TEST_USER_ID },
    orderBy: { createdAt: 'asc' },
  });
  const axesFilled = snaps.every((s) => s.axes !== null);
  check(
    'b  이력 스냅샷 axes',
    axesFilled && snaps.length === 2,
    `${snaps.length}건, axes 채움=${axesFilled}, 점수=[${snaps.map((s) => s.score).join(',')}]`,
  );

  // (c) 멱등
  const second = await provisionDemoData(prisma, TEST_USER_ID, { idPrefix: TEST_PREFIX });
  const c2 = await counts(TEST_USER_ID);
  check(
    'c  멱등 재실행',
    second.provisioned === false && JSON.stringify(c1) === JSON.stringify(c2),
    `provisioned=${second.provisioned}, 레코드 불변=${JSON.stringify(c1) === JSON.stringify(c2)}`,
  );

  // (d) 점수 경로 정합 — 폴백 없이 본인 데이터로 계산
  const score = await getScoreForUser(TEST_USER_ID);
  const axesStr = AXES.map((k) => `${k}=${score.axes[k].score === null ? 'null' : Math.round(score.axes[k].score as number)}`).join(' ');
  check(
    'd1 폴백 미발동',
    score.fallback === 'none',
    `fallback=${score.fallback} (시드 유저를 빌려오지 않아야 정상)`,
  );
  check(
    'd2 종합·4축 산출',
    score.score > 0 && AXES.every((k) => score.axes[k].measured),
    `종합=${score.score}(${score.grade}) · ${axesStr} · coverage=${score.coveredCount}/${score.totalCount}`,
  );

  // (e) 쓰기 경로 — PATCH /api/accounts/[id]가 쓰는 소유권 조회가 통과해야 404가 안 난다
  const target = await prisma.account.findFirst({ where: { userId: TEST_USER_ID } });
  const owned = target
    ? await prisma.account.findFirst({ where: { id: target.id, userId: TEST_USER_ID } })
    : null;
  check('e  소유권 검증 통과', owned !== null, `대상 id 접두=${TEST_PREFIX}-*, 조회=${owned ? 'hit' : 'miss'}`);

  console.log(`\n결과: ${failures === 0 ? '전 항목 PASS' : `${failures}건 FAIL`}`);
}

main()
  .catch((e) => {
    console.error(e);
    failures += 1;
  })
  .finally(async () => {
    // 임시 사용자 정리(공유 DB 오염 방지)
    await purgeProvisionedData(prisma, TEST_USER_ID);
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
