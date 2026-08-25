// 기획의도(I1~I5)가 지금 실제로 어디까지 서 있는지 잰다 — 읽기 전용.
//
// 실행: pnpm exec tsx --env-file=.env scripts/check-intent-status.ts
//
// 정본: 옵시디언 "이레이지-완성도WBS-20260821" (I1 한 흐름 통합 / I2 4축·최약축 /
//       I3 회복 서사 / I4 정직성 / I5 앵커 비의존)
//
// 왜 스크립트인가: "기획대로 되고 있나"에 인상으로 답하면 다음에 또 인상으로 답하게 된다.
// 축이 켜졌는지, 카탈로그가 얼마나 찼는지는 세면 나오는 값이다.
import { PrismaClient } from '@prisma/client';
import { getScoreForUser } from '../lib/score-service';

export {};

const prisma = new PrismaClient();
const AXES = ['exposure', 'surface', 'hygiene', 'threat'] as const;

function w(s: string): number {
  return [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
}
function row(k: string, v: string): void {
  console.log(`  ${k}${' '.repeat(Math.max(0, 34 - w(k)))} ${v}`);
}

async function main(): Promise<void> {
  // 무대 계정 = 계정 수가 가장 많은 사용자(실계정). 시드 24건 사용자들과 구분된다.
  const users = await prisma.user.findMany({
    select: { id: true, _count: { select: { accounts: true } } },
  });
  const stage = users.sort((a, b) => b._count.accounts - a._count.accounts)[0];
  if (!stage) throw new Error('사용자가 없다');

  const s = await getScoreForUser(stage.id);

  console.log('\n[I2] 4축 — 무대 계정');
  for (const k of AXES) {
    const a = s.axes[k];
    row(
      k,
      a.measured
        ? `${Math.round(a.score ?? 0)}점 · coverage ${a.coveredCount}/${a.totalCount}`
        : '미측정 — 잴 근거가 없다',
    );
  }
  row('종합', `${s.score} (${s.grade}) · 측정 ${AXES.filter((k) => s.axes[k].measured).length}/4축`);
  row('최약축', String(s.weakestAxis));

  console.log('\n[I3] 회복 서사');
  const acked = await prisma.account.count({
    where: { userId: stage.id, discovered: true, acknowledgedAt: { not: null } },
  });
  const unacked = await prisma.account.count({
    where: { userId: stage.id, discovered: true, acknowledgedAt: null },
  });
  const queued = await prisma.cleanupRequest.count({
    where: { userId: stage.id, status: { in: ['queued', 'in_progress'] } },
  });
  row('몰랐던 계정 — 확인함', `${acked}건`);
  row('몰랐던 계정 — 미확인', `${unacked}건`);
  row('정리 큐 대기', `${queued}건`);
  row('회복 투영', `${s.score} → ${s.recovery?.afterComposite ?? '(없음)'}`);

  console.log('\n[I4] 정직성 — 서비스 카탈로그');
  const [svc, withDomain, withVerified, noDisplay] = await Promise.all([
    prisma.service.count(),
    prisma.service.count({ where: { domain: { not: null } } }),
    prisma.service.count({ where: { verifiedAt: { not: null } } }),
    prisma.service.count({ where: { displayName: null } }),
  ]);
  row('Service 총계', `${svc}개`);
  row('domain 보유', `${withDomain}개 (WBS 목표 130+)`);
  row('verifiedAt 보유', `${withVerified}개 (WBS 목표 80+)`);
  row('displayName 없음', `${noDisplay}개`);

  const unlinked = await prisma.account.count({ where: { serviceId: null } });
  row('serviceId 미연결 계정', `${unlinked}건`);

  console.log('\n[I4] 정직성 — 대조 이력');
  const noCheck = await prisma.user.count({
    where: { breachCheckedAt: null, breaches: { some: {} } },
  });
  row('유출은 있는데 대조시각 없음', `${noCheck}명 (0이어야 정상)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
