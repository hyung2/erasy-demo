// 실 로그인 후 확인 — signIn 콜백 프로비저닝 배선이 실제로 동작했는지 DB로 판정.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-login-provision.ts
//
// 시드 유저를 제외한 실 사용자(google sub)별로 계정·스냅샷 보유 상태와 점수를 출력한다.
// 이메일·이름 등 개인정보는 출력하지 않는다(id 앞 4자만 마스킹 표기).
import { prisma } from '../lib/prisma';
import { getScoreForUser } from '../lib/score-service';
import { DEMO_USER_ID } from '../lib/dummy-data';
import type { AxisKey } from '../lib/score-v2';

const AXES: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];

function mask(id: string): string {
  return `${id.slice(0, 4)}…(${id.length}자)`;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { id: { not: DEMO_USER_ID } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log('실 로그인 사용자 없음 — 로그인 후 다시 실행하세요.');
    return;
  }

  for (const u of users) {
    const [accounts, snapshots, ownPrefix] = await Promise.all([
      prisma.account.count({ where: { userId: u.id } }),
      prisma.scoreSnapshot.count({ where: { userId: u.id } }),
      prisma.account.count({ where: { userId: u.id, id: { startsWith: `u${u.id}-` } } }),
    ]);
    const score = await getScoreForUser(u.id);
    const axesStr = AXES.map(
      (k) => `${k}=${score.axes[k].score === null ? 'null' : Math.round(score.axes[k].score as number)}`,
    ).join(' ');
    const verdict = accounts === 24 && ownPrefix === 24 && score.fallback === 'none';
    console.log(
      `${verdict ? 'PASS' : 'CHECK'}  user=${mask(u.id)} · 계정 ${accounts}(본인접두 ${ownPrefix}) · ` +
        `스냅샷 ${snapshots} · 종합 ${score.score}(${score.grade}) · ${axesStr} · fallback=${score.fallback}`,
    );
    // 추이 차트 입력(실 스냅샷) — 2점 이상이어야 대시보드가 선을 그린다.
    const pts = score.trendPoints
      .map((p) => `${p.at.slice(5, 10)}:${p.score}`)
      .join(' → ');
    console.log(
      `        추이 ${score.trendPoints.length}점 [${pts}] · 차트 렌더=${score.trendPoints.length >= 2 ? 'YES' : 'NO(안내문구)'}`,
    );
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
