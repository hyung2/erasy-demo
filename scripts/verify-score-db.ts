// 런타임 실측(T3.2/T3.3) — 실제 Neon DB 대상. /api/score와 동일 코드 경로(score-service) 검증.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-score-db.ts
// 출력: 테이블 카운트(시드 drift 확인용) + 점수/coverage/스냅샷 append 동작. 시크릿 미출력.
import { prisma } from '../lib/prisma';
import { getScoreForUser } from '../lib/score-service';
import { DEMO_USER_ID } from '../lib/dummy-data';

async function counts() {
  const [accounts, breaches, accessLogs, cleanups, snapshots] = await Promise.all([
    prisma.account.count({ where: { userId: DEMO_USER_ID } }),
    prisma.breach.count({ where: { userId: DEMO_USER_ID } }),
    prisma.accessLog.count({ where: { account: { userId: DEMO_USER_ID } } }),
    prisma.cleanupRequest.count({ where: { userId: DEMO_USER_ID } }),
    prisma.scoreSnapshot.count({ where: { userId: DEMO_USER_ID } }),
  ]);
  return { accounts, breaches, accessLogs, cleanups, snapshots };
}

async function main() {
  console.log('[before]', JSON.stringify(await counts()));

  // 1차 계산 — 점수 변경 시 스냅샷 append 기대
  const r1 = await getScoreForUser(DEMO_USER_ID);
  console.log(
    '[score#1]',
    JSON.stringify({
      score: r1.score,
      grade: r1.grade,
      delta: r1.delta,
      trend: r1.trend,
      coverage: r1.coverage,
      coveredCount: r1.coveredCount,
      totalCount: r1.totalCount,
      fallback: r1.fallback,
    }),
  );
  console.log('[after#1]', JSON.stringify(await counts()));

  // 2차 계산 — 동일 점수·24h 이내 → append 억제(행 남발 방지) 기대
  const r2 = await getScoreForUser(DEMO_USER_ID);
  console.log('[score#2]', JSON.stringify({ score: r2.score, delta: r2.delta, trend: r2.trend }));
  console.log('[after#2]', JSON.stringify(await counts()));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
