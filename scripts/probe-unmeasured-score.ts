// 신호가 하나도 관측되지 않은 사용자의 종합 점수가 무엇으로 나오는지 잰다 — 격리 DB 전용.
//
// 실행: DATABASE_URL=<격리> pnpm exec tsx scripts/probe-unmeasured-score.ts
//
// 왜: verify-idor-2user 5번과 verify-revoke-roundtrip e·j가 모두 "0 → 0"으로 걸렸다.
// 위험 신호를 심은 A와 아무 신호도 없는 B가 **똑같이 0점**이면 두 사용자를 구분할 수 없다.
// 바닥에서 뭉개진 것인지, 점수가 아예 안 도는 것인지를 갈라야 한다.
import { PrismaClient } from '@prisma/client';
import { getScoreForUser } from '../lib/score-service';

export {};

const DB = process.env.DATABASE_URL ?? '';
if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('[abort] 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();
const AXES = ['exposure', 'surface', 'hygiene', 'threat'] as const;

async function makeUser(id: string, signals: boolean): Promise<void> {
  await prisma.user.create({ data: { id, email: `${id}@example.invalid`, name: id } });
  for (let i = 0; i < 3; i += 1) {
    await prisma.account.create({
      data: {
        id: `${id}-a${i}`,
        userId: id,
        name: `서비스${i}`,
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
        ...(signals
          ? { passwordReused: true, twoFactorEnabled: false, discovered: true }
          : {}),
      },
    });
  }
}

async function show(id: string, label: string): Promise<void> {
  const s = await getScoreForUser(id);
  const axes = AXES.map((k) => `${k}=${s.axes[k].measured ? Math.round(s.axes[k].score ?? 0) : '미측정'}`);
  console.log(`${label}\n  종합 ${s.score} (${s.grade}) · ${axes.join(' · ')}`);
}

async function main(): Promise<void> {
  await makeUser('probe-signals', true);
  await makeUser('probe-nosignals', false);
  await show('probe-signals', '[신호 있음] 비번 재사용·2FA 없음·미확인 3건');
  await show('probe-nosignals', '[신호 없음] 계정 3건, 관측된 신호 0');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ['probe-signals', 'probe-nosignals'] } } });
    await prisma.$disconnect();
  });
