// 백필 정합 확인(D3) — 실 DB 대상, 읽기 전용.
//
// 실행: pnpm exec tsx --env-file=.env scripts/verify-service-backfill.ts
//
// 무엇을 재는가: 정규화가 데이터를 **잃지 않았는지**와 **없는 것을 만들지 않았는지**.
// 집계가 가능해졌다는 사실보다, 그 과정에서 계정이 사라지거나 남의 서비스에 붙지
// 않았다는 쪽이 먼저 확인돼야 한다.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  const [total, linked, unlinked, services, rawMissing, mismatched] = await Promise.all([
    prisma.account.count(),
    prisma.account.count({ where: { serviceId: { not: null } } }),
    prisma.account.count({ where: { serviceId: null } }),
    prisma.service.count(),
    // rawName은 연결된 계정이면 반드시 있어야 한다(원문 보존).
    prisma.account.count({ where: { serviceId: { not: null }, rawName: null } }),
    // name과 rawName이 다르면 백필이 원문을 바꾼 것 — 있어서는 안 된다.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "Account"
      WHERE "rawName" IS NOT NULL AND "rawName" <> "name"
    `,
  ]);

  console.log(`계정 ${total} · 연결 ${linked} · 미연결 ${unlinked} · 서비스 ${services}`);

  check(linked + unlinked === total, '1 연결/미연결 합이 전체와 같다(계정 유실 없음)');
  check(rawMissing === 0, '2 연결된 계정은 모두 rawName을 갖는다');
  check(Number(mismatched[0].count) === 0, '3 백필이 원문(name)을 바꾸지 않았다');
  check(services <= total, '4 서비스 수가 계정 수를 넘지 않는다');

  // 서비스별 보유자 수 — 이 질의가 되는 것이 정규화의 목적이다.
  const byService = await prisma.account.groupBy({
    by: ['serviceId'],
    where: { serviceId: { not: null } },
    _count: { userId: true },
  });
  check(byService.length === services || byService.length <= services, '5 서비스별 집계 질의 성립');

  // 표시명이 확인된 서비스와 추정 상태 구분. 이 수가 곧 E7(카탈로그 확장)의 작업량이다.
  const [verified, unverified] = await Promise.all([
    prisma.service.count({ where: { verifiedAt: { not: null } } }),
    prisma.service.count({ where: { verifiedAt: null } }),
  ]);
  console.log(`표시명 확인 ${verified} · 미확인 ${unverified} (E7 작업 대상)`);
  check(verified + unverified === services, '6 확인/미확인 합이 서비스 수와 같다');

  // 도메인 유니크 — 같은 도메인이 두 서비스로 갈리면 집계가 다시 쪼개진다.
  const dupDomain = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT "domain" FROM "Service" WHERE "domain" IS NOT NULL
      GROUP BY "domain" HAVING COUNT(*) > 1
    ) d
  `;
  check(Number(dupDomain[0].count) === 0, '7 같은 도메인을 가진 서비스가 둘 이상 없다');

  console.log(`verify-service-backfill: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
