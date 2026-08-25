// 시험 계정 잔재 점검 — 읽기만 한다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/check-test-residue.ts
//
// prod와 같은 Neon을 쓰므로 가드가 만든 임시 사용자가 남으면 그대로 운영 데이터가 된다.
// 시험 계정은 전부 `@example.invalid`를 쓰기로 했으므로 그 도메인으로 센다.
import { PrismaClient } from '@prisma/client';

export {};

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const residue = await prisma.user.findMany({
    where: { email: { endsWith: '@example.invalid' } },
    select: { id: true, email: true, createdAt: true },
  });
  const [users, accounts, services] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.service.count(),
  ]);

  console.log(`시험 잔재(@example.invalid): ${residue.length}건`);
  residue.forEach((r) => console.log(`  ${r.email} · ${r.createdAt.toISOString()}`));
  console.log(`전체 — 사용자 ${users} · 계정 ${accounts} · 서비스 ${services}`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
