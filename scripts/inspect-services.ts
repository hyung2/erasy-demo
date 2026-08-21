// 서비스 정규화 현황을 뜯어본다(읽기 전용).
//
// 실행: pnpm exec tsx --env-file=.env scripts/inspect-services.ts
//
// 표시명을 채우는 작업(E7)의 대상이 실제로 무엇인지 보기 위한 도구다. "미확인 253건"이라는
// 수는 작업량을 말해 주지만 **무엇을 해야 하는지**는 말해 주지 않는다. 도메인이 이미
// 있는 것과 이름만 있는 것은 필요한 일이 전혀 다르다.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const services = await prisma.service.findMany({
    select: {
      slug: true,
      domain: true,
      displayName: true,
      category: true,
      verifiedAt: true,
      _count: { select: { accounts: true } },
    },
  });

  const withDomain = services.filter((s) => s.domain !== null);
  const nameOnly = services.filter((s) => s.domain === null);

  // 도메인이 있고 표시명이 없는 것 = 화면에 도메인이 그대로 노출되는 계정들.
  // 카탈로그에 표시명을 추가하면 해결된다.
  const domainNoName = withDomain.filter((s) => s.displayName === null);
  // 이름만 있는 것 = 확장·사용자가 준 이름. 도메인을 사람이 부여해야 병합이 가능해진다.
  const nameNoDomain = nameOnly.filter((s) => s.displayName !== null);

  console.log(
    JSON.stringify(
      {
        total: services.length,
        withDomain: withDomain.length,
        nameOnly: nameOnly.length,
        verified: services.filter((s) => s.verifiedAt !== null).length,
        domainButNoDisplayName: domainNoName.length,
        nameButNoDomain: nameNoDomain.length,
        categoryUnknown: services.filter((s) => s.category === 'unknown').length,
      },
      null,
      1,
    ),
  );

  const top = (rows: typeof services, n: number) =>
    [...rows]
      .sort((a, b) => b._count.accounts - a._count.accounts)
      .slice(0, n)
      .map((s) => `${s._count.accounts}  ${s.displayName ?? s.domain ?? s.slug}`);

  console.log('\n[도메인 있음 · 표시명 없음] 상위 20 — 카탈로그에 이름만 추가하면 해결');
  console.log(top(domainNoName, 20).join('\n'));

  console.log('\n[이름만 있음 · 도메인 없음] 상위 20 — 도메인을 사람이 부여해야 병합됨');
  console.log(top(nameNoDomain, 20).join('\n'));
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
