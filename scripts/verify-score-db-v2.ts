// 런타임 실측(T4.3) — 실제 Neon DB 대상. /api/score와 동일 코드 경로(score-service v2) 검증.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-score-db-v2.ts
// 검증: (a) 종합 24 (b) axes 4축 값[~34/66/9/60] + measured (c) 스냅샷 axes JSON 저장·재조회.
// 시크릿 미출력(카운트·점수만).
import { prisma } from '../lib/prisma';
import { getScoreForUser } from '../lib/score-service';
import { DEMO_USER_ID } from '../lib/dummy-data';
import type { AxisKey } from '../lib/score-v2';

const AXES: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];

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

function fmtAxes(axes: Awaited<ReturnType<typeof getScoreForUser>>['axes']) {
  return AXES.map((k) => {
    const a = axes[k];
    const raw = a.score === null ? 'null' : Math.round(a.score * 100) / 100;
    const disp = a.score === null ? 'null' : Math.round(a.score);
    return `${k}=${disp}(raw ${raw}, measured=${a.measured}, cov ${a.coveredCount}/${a.totalCount})`;
  }).join(' · ');
}

async function main() {
  console.log('[before]', JSON.stringify(await counts()));

  // (a)(b) 종합·4축 실측
  const r = await getScoreForUser(DEMO_USER_ID);
  console.log(
    '[score]',
    JSON.stringify({
      score: r.score,
      grade: r.grade,
      weakestAxis: r.weakestAxis,
      delta: r.delta,
      trend: r.trend,
      coverage: Math.round(r.coverage * 100) / 100,
      coveredCount: r.coveredCount,
      totalCount: r.totalCount,
      fallback: r.fallback,
    }),
  );
  console.log('[axes]', fmtAxes(r.axes));
  console.log(
    '[expectedGains]',
    r.expectedGains.map((e) => `${e.actionType}:+${e.expectedGain}`).join(' · '),
  );
  console.log('[after]', JSON.stringify(await counts()));

  // (c) 스냅샷 axes JSON 저장·재조회 — 최신 스냅샷 직접 read
  const snap = await prisma.scoreSnapshot.findFirst({
    where: { userId: DEMO_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  console.log(
    '[snapshot#latest]',
    JSON.stringify({ score: snap?.score, coverage: snap?.coverage, coveredCount: snap?.coveredCount, hasAxes: snap?.axes != null }),
  );
  console.log('[snapshot.axes]', JSON.stringify(snap?.axes));

  // 판정 요약
  const axesOk = AXES.every((k) => r.axes[k].measured);
  const compositeOk = r.score === 24;
  const axesPersisted = snap?.axes != null;
  console.log(
    `[verdict] composite24=${compositeOk} · 4축measured=${axesOk} · axes재조회=${axesPersisted}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
