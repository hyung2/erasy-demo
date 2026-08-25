// 대조 시각이 비어 있는 채로 유출 이력만 가진 사용자를 메운다 — 1회성 백필.
//
// 실행: pnpm exec tsx --env-file=.env scripts/backfill-breach-checked.ts        (드라이런)
//       pnpm exec tsx --env-file=.env scripts/backfill-breach-checked.ts --apply (실제 반영)
//
// 왜: provisionDemoData가 유출 이력을 심으면서 User.breachCheckedAt을 찍지 않았다.
// 그래서 그 시기에 프로비저닝된 사용자는 화면이 "미해결 유출 N건"과 "아직 대조하지
// 않았어요"를 동시에 말한다. 코드는 고쳤지만 이미 만들어진 사용자는 그대로 남는다.
//
// 대상은 **대조 시각이 비어 있고 유출 이력이 있는** 사용자로 좁힌다. 대조 시각이 이미
// 있으면 실제 대조가 있었다는 뜻이므로 건드리지 않는다.
//
// 찍는 값은 now가 아니라 **그 사용자의 가입 시각**이다. 프로비저닝은 첫 로그인 때 일어나고
// 유출 이력도 그때 적재되므로, 우리가 그 결과를 기록한 시점이 곧 가입 시점이다.
// (Breach에는 생성 시각 컬럼이 없어 그쪽을 쓸 수 없다.)
// now로 찍으면 오늘 대조한 것처럼 보인다 — 이 수정이 없애려던 바로 그 종류의 거짓말이다.
import { PrismaClient } from '@prisma/client';

export {};

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const targets = await prisma.user.findMany({
    where: { breachCheckedAt: null, breaches: { some: {} } },
    select: {
      id: true,
      createdAt: true,
      _count: { select: { breaches: true } },
    },
  });

  console.log(`${APPLY ? '[반영]' : '[드라이런]'} 대상 ${targets.length}명`);
  for (const u of targets) {
    const stamp = u.createdAt;
    const masked = `${u.id.slice(0, 4)}…(${u.id.length}자)`;
    console.log(`  ${masked} · 유출 ${u._count.breaches}건 · 대조시각 ← ${stamp.toISOString()}`);
    if (APPLY) {
      await prisma.user.update({ where: { id: u.id }, data: { breachCheckedAt: stamp } });
    }
  }

  const left = await prisma.user.count({ where: { breachCheckedAt: null, breaches: { some: {} } } });
  console.log(`남은 미기록: ${left}명`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
