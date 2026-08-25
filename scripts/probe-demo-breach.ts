// 데모 계정에서 "유출"이 화면 세 곳에 각각 뭐라고 나오는지 잰다 — 읽기만 하고 정리한다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/probe-demo-breach.ts
//
// 왜: verify-provision d2가 exposure=null로 걸렸다. 시드는 유출 4건을 심는데 점수 엔진은
// "아직 대조하지 않았다"고 본다. 같은 화면에서 두 말이 나오는지 확인한다.
import { PrismaClient } from '@prisma/client';
import { provisionDemoData } from '../lib/provision-demo';
import { getScoreForUser } from '../lib/score-service';

export {};

const prisma = new PrismaClient();
const ID = `uprobe-demo-breach-${Date.now()}`;

async function main(): Promise<void> {
  await prisma.user.create({
    data: { id: ID, email: `${ID}@example.invalid`, name: '프로브' },
  });
  await provisionDemoData(prisma, ID, { idPrefix: `pdb-${ID}-` });

  const [user, breaches, breachedAccounts, score] = await Promise.all([
    prisma.user.findUnique({ where: { id: ID }, select: { breachCheckedAt: true } }),
    prisma.breach.count({ where: { userId: ID, resolved: false } }),
    prisma.account.count({ where: { userId: ID, breached: true } }),
    getScoreForUser(ID),
  ]);

  console.log(`대조 시각(User.breachCheckedAt) : ${user?.breachCheckedAt ?? 'null → "아직 대조하지 않았어요"'}`);
  console.log(`미해결 Breach 행               : ${breaches}건`);
  console.log(`Account.breached 캐시           : ${breachedAccounts}건`);
  console.log(`유출 축(exposure)               : ${score.axes.exposure.measured ? score.axes.exposure.score : '미측정'}`);
  console.log(`종합                            : ${score.score} (${score.grade}) · 측정된 축 ${
    (['exposure', 'surface', 'hygiene', 'threat'] as const).filter((k) => score.axes[k].measured).length
  }/4`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.user.delete({ where: { id: ID } }).catch(() => {});
    await prisma.$disconnect();
  });
