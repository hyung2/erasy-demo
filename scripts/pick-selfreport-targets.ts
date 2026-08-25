// 위생축을 켤 자가신고 대상 계정을 뽑는다 — 읽기 전용.
//
// 실행: pnpm exec tsx --env-file=.env scripts/pick-selfreport-targets.ts [건수]
//
// 위생축은 우리가 비밀번호를 저장하지 않는 한 잴 수 없다. 사용자가 계정마다 "이 비번을
// 다른 데서도 쓰는가 / 2단계 인증을 켰는가"를 직접 알려줄 때만 그 계정이 분모에 든다.
//
// 무엇을 먼저 물을 것인가가 중요하다. 아무 계정이나 6건 채우면 축은 켜지지만 그 수치는
// 사용자에게 아무 말도 하지 않는다. **본인이 실제로 쓰는, 뚫리면 아픈 계정**부터 묻는다.
//
// 고르는 기준 (내림차순)
//   1. 최근에 쓴 것 — 사용일을 아는 계정은 본인이 상태도 안다
//   2. 유출 이력이 있는 곳 — 재사용 여부가 곧 피해 반경이다
//   3. 결제·신원이 걸린 곳 — 뚫렸을 때 손실이 큰 순서
// 사용일 미상은 뒤로 민다. 기억나지 않는 계정에 답하게 하면 추측이 데이터가 된다.
import { PrismaClient } from '@prisma/client';

export {};

const prisma = new PrismaClient();
const WANT = Number(process.argv[2] ?? 10);

/** 뚫렸을 때 손실이 큰 자리. 이름이 아니라 성격으로 고른다. */
const HIGH_STAKES = [
  '카카오', '네이버', '구글', 'Google', 'Apple', 'iCloud', '토스', '쿠팡', '배달',
  '넷플릭스', 'Netflix', '당근', '11번가', 'G마켓', '옥션', '인터파크', 'PAYCO',
  '페이코', '신한', '국민', '우리', '하나', '농협', '삼성', 'SK', 'KT', 'LG',
];

function stakes(name: string): number {
  return HIGH_STAKES.some((k) => name.includes(k)) ? 1 : 0;
}

function w(s: string): number {
  return [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
}
function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - w(s)));
}

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, _count: { select: { accounts: true } } },
  });
  const stage = users.sort((a, b) => b._count.accounts - a._count.accounts)[0];
  if (!stage) throw new Error('사용자가 없다');

  const accounts = await prisma.account.findMany({
    where: { userId: stage.id, selfReportedAt: null },
    select: {
      name: true,
      source: true,
      lastUsedAt: true,
      breached: true,
      provider: true,
    },
  });

  const now = Date.now();
  const scored = accounts
    .map((a) => {
      const days = a.lastUsedAt ? Math.floor((now - a.lastUsedAt.getTime()) / 86_400_000) : null;
      // 최근일수록 높게. 사용일 미상은 최하위로 민다.
      const recency = days === null ? -1 : Math.max(0, 400 - days) / 400;
      return { ...a, days, rank: recency + (a.breached ? 1.5 : 0) + stakes(a.name) * 0.8 };
    })
    .sort((x, y) => y.rank - x.rank)
    .slice(0, WANT);

  console.log(`\n자가신고 대상 ${scored.length}건 — 계정 스캔 화면에서 각 행의 자가신고 버튼\n`);
  console.log(`  ${pad('서비스', 26)} ${pad('마지막 사용', 14)} ${pad('출처', 12)} 비고`);
  console.log(`  ${'-'.repeat(70)}`);
  for (const a of scored) {
    const used = a.days === null ? '미상' : `${a.days}일 전`;
    const note = [a.breached ? '유출 이력' : '', stakes(a.name) ? '피해 큼' : '']
      .filter(Boolean)
      .join(' · ');
    console.log(`  ${pad(a.name, 26)} ${pad(used, 14)} ${pad(a.source, 12)} ${note}`);
  }

  const observed = await prisma.account.count({
    where: { userId: stage.id, selfReportedAt: { not: null } },
  });
  console.log(`\n현재 위생축 관측 ${observed}건 — 0이면 축이 미측정 상태입니다.`);
  console.log('물어보는 것은 두 가지뿐입니다. 이 비밀번호를 다른 곳에서도 쓰는지, 2단계 인증을 켰는지.');
  console.log('모르면 넘어가십시오 — 추측해서 넣으면 그 수치가 거짓이 됩니다.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
