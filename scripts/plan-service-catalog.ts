// 서비스 카탈로그를 무엇으로 채울 수 있는지 근거별로 센다 — 읽기 전용.
//
// 실행: pnpm exec tsx --env-file=.env scripts/plan-service-catalog.ts [--list]
//
// 원칙: **추정 표기 0건.** 확인 못 한 것은 그대로 둔다. 도메인은 이 설계에서 사실상의 신원이라,
// 잘못 넣으면 서로 다른 서비스가 합쳐지고 유출 사건이 엉뚱한 사람에게 붙는다. 빈칸이 틀린
// 값보다 낫다.
//
// 근거는 두 갈래뿐이다.
//   A. 큐레이션 카탈로그 — 사람이 서비스명과 도메인을 짝지어 적어 둔 것(gmail-catalog)
//   B. 이름이 곧 도메인 — 수집 원문이 "zdnet.co.kr"처럼 도메인 그 자체인 경우.
//      이건 추론이 아니라 관측이다. 우리가 받은 값이 도메인이다.
//
// B에는 표시명을 짓지 않는다. "zdnet.co.kr"을 "ZDNet Korea"로 바꾸는 것은 아는 것이 아니라
// 지어내는 것이다. 도메인만 채우고 표시명은 비워 둔다.
import { PrismaClient } from '@prisma/client';
import { CATALOG } from '../lib/gmail-catalog';

/**
 * 카탈로그에서 서비스명으로 도메인을 찾는다.
 *
 * `siteDomainFor`를 쓰지 않는 이유: 그 함수는 **메일 전용 도메인을 걸러낸다**. 정리하러 갈
 * 곳을 고르는 용도라 gmail.com으로 보내면 안 되기 때문인데, 지금 우리가 정하려는 것은
 * "갈 곳"이 아니라 **신원**이다. Gmail의 도메인은 gmail.com이 맞다.
 * 용도가 다른 필터를 재사용하면 근거가 있는 것까지 근거 없음으로 떨어진다.
 */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '');
function catalogDomain(name: string): string | null {
  const k = norm(name);
  const hit = CATALOG.find(
    (e) => norm(e.service) === k || (e.aliases ?? []).some((a) => norm(a) === k),
  );
  return hit?.domains[0] ?? null;
}

export {};

const prisma = new PrismaClient();
const LIST = process.argv.includes('--list');

/** 이름 자체가 도메인인가. 관측된 값을 그대로 쓰는 경우만 통과시킨다. */
function nameIsDomain(name: string): boolean {
  const s = name.trim().toLowerCase();
  if (/\s/.test(s)) return false;
  // 최소 2단계, 마지막 마디가 알파벳 2자 이상. 한글·특수문자는 배제한다.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) && /\.[a-z]{2,}$/.test(s);
}

async function main(): Promise<void> {
  const services = await prisma.service.findMany({
    select: {
      id: true,
      slug: true,
      displayName: true,
      domain: true,
      verifiedAt: true,
      _count: { select: { accounts: true } },
    },
  });

  const withDomain = services.filter((s) => s.domain);
  const missing = services.filter((s) => !s.domain);

  const byCatalog: typeof missing = [];
  const byName: typeof missing = [];
  const unknown: typeof missing = [];

  for (const s of missing) {
    const label = s.displayName ?? s.slug;
    if (catalogDomain(label)) byCatalog.push(s);
    else if (nameIsDomain(label)) byName.push(s);
    else unknown.push(s);
  }

  const holders = (rows: typeof missing): number =>
    rows.reduce((a, r) => a + r._count.accounts, 0);

  console.log(`\nService ${services.length}개 · 도메인 보유 ${withDomain.length}개`);
  console.log(`확인됨(verifiedAt) ${services.filter((s) => s.verifiedAt).length}개\n`);
  console.log('도메인 없는 것을 근거별로 나누면');
  console.log(`  A 카탈로그로 채울 수 있다   ${String(byCatalog.length).padStart(3)}개 · 계정 ${holders(byCatalog)}건`);
  console.log(`  B 이름이 곧 도메인이다      ${String(byName.length).padStart(3)}개 · 계정 ${holders(byName)}건`);
  console.log(`  C 근거 없음 — 두고 간다     ${String(unknown.length).padStart(3)}개 · 계정 ${holders(unknown)}건`);
  console.log(`\n채우면 도메인 보유 ${withDomain.length} → ${withDomain.length + byCatalog.length + byName.length}개`);

  if (LIST) {
    console.log('\n[A] 카탈로그 근거');
    byCatalog
      .sort((x, y) => y._count.accounts - x._count.accounts)
      .forEach((s) => console.log(`  ${(s.displayName ?? s.slug).padEnd(24)} → ${catalogDomain(s.displayName ?? s.slug)}`));
    console.log('\n[C] 근거 없는 것 상위 15개 — 사람이 확인해야 채워진다');
    unknown
      .sort((x, y) => y._count.accounts - x._count.accounts)
      .slice(0, 15)
      .forEach((s) => console.log(`  계정 ${String(s._count.accounts).padStart(2)}건  ${s.displayName ?? s.slug}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
