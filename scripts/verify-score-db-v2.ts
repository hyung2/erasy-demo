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
  //
  // 이 스크립트는 오랫동안 판정을 **출력만** 하고 종료 코드 0으로 끝났다. 그래서 08-21부터
  // `4축measured=false`를 계속 찍고 있었는데도 성공으로 집계됐고, 데모 계정이 유출을 띄운 채
  // "아직 대조하지 않았어요"라고 말하는 상태가 나흘간 남았다(2026-08-25 발견).
  // 판정을 적어 두고 종료 코드로 내보내지 않으면 아무도 읽지 않는다.
  //
  // 종합 점수는 게이트로 쓰지 않는다 — 시드가 상대 시각을 쓰므로 하루 사이에도 1점씩 움직인다.
  // 흔들리는 값을 게이트에 걸면 실패에 무뎌지고, 무뎌진 게이트는 없는 것과 같다.
  // 대신 구조적 주장 둘을 건다: 4축이 모두 측정되는가, 축이 스냅샷에 남아 재조회되는가.
  const axesOk = AXES.every((k) => r.axes[k].measured);
  const axesPersisted = snap?.axes != null;
  const unmeasured = AXES.filter((k) => !r.axes[k].measured);

  if (!axesOk) console.log(`  FAIL 4축 전부 측정 — 미측정: ${unmeasured.join(', ')}`);
  if (!axesPersisted) console.log('  FAIL 스냅샷에 axes가 남아 재조회된다');

  const passed = (axesOk ? 1 : 0) + (axesPersisted ? 1 : 0);
  const failed = 2 - passed;
  console.log(`[종합] ${r.score}점 (게이트 아님 — 값 확인용)`);
  console.log(`verify-score-db-v2: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
