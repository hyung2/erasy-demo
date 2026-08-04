// 런타임 실측 — 회복 투영이 **그 사용자의 실데이터**를 따라가는지 회귀 가드. 실제 DB 대상.
// 실행: pnpm exec tsx scripts/verify-recovery-projection.ts
//
// 왜 이 가드가 필요한가
//   `/cleanup/result`가 클라이언트에서 `projectRecovery()`를 인자 없이 호출해 시드로 계산했다.
//   그래서 계정을 몇 개 발견하든 화면은 항상 24→93이었고, 대시보드가 19로 내려가도 결과 화면만
//   24에서 출발했다 — 한 제품에 출발점이 두 개(2026-08-04 실측). 07-15 B1(결과화면 22→100
//   투영 전삭제 버그)과 같은 화면에서 난 두 번째 사고라 영구 가드로 남긴다.
//
// 검증 항목
//   (a) 프로비저닝 직후 — 투영 before가 대시보드 종합과 **같은 값**이고 after가 계단 최종 93
//   (b) 발견 계정 15개 추가 후 — 종합이 내려가고 투영 before가 **그 내려간 값을 따라감**
//   (c) 삭제 표적은 정리 큐 미완료분뿐 — 큐에 없는 계정을 임의로 지워 after를 부풀리지 않음
//   (d) 큐를 비우면 after가 before로 수렴(정리할 게 없으면 회복 여지도 없다)
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유). 시크릿 미출력.
import { prisma } from '../lib/prisma';
import { provisionDemoData, purgeProvisionedData } from '../lib/provision-demo';
import { getScoreForUser } from '../lib/score-service';

const TEST_USER_ID = 'verify-recovery-projection-tmp';

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

async function cleanup() {
  await purgeProvisionedData(prisma, TEST_USER_ID);
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function main() {
  await cleanup();
  await prisma.user.create({
    data: { id: TEST_USER_ID, email: `${TEST_USER_ID}@example.invalid`, name: '투영 검증' },
  });
  await provisionDemoData(prisma, TEST_USER_ID, { idPrefix: `u${TEST_USER_ID}` });

  // (a) 기준선 — 투영 before가 종합과 일치하고 after가 계단 최종
  const base = await getScoreForUser(TEST_USER_ID);
  check(
    'a1 투영 before = 대시보드 종합',
    base.recovery.beforeComposite === base.score,
    `before=${base.recovery.beforeComposite} · 종합=${base.score}`,
  );
  check(
    'a2 투영 after = 93(계단 최종)',
    base.recovery.afterComposite === 93,
    `after=${base.recovery.afterComposite}`,
  );

  // (b) 발견 계정 15개 추가 — 메일 스캔이 저장하는 형태 그대로
  await prisma.account.createMany({
    data: Array.from({ length: 15 }, (_, i) => ({
      userId: TEST_USER_ID,
      name: `발견서비스${i}`,
      provider: 'manual' as const,
      category: 'unknown' as const,
      source: 'mail_scan' as const,
      discovered: true,
      lastUsedAt: new Date(Date.now() - (i % 4 === 0 ? 200 : 900) * 86_400_000),
    })),
  });

  const grown = await getScoreForUser(TEST_USER_ID);
  check(
    'b1 발견 후 종합 하락',
    grown.score < base.score,
    `${base.score} → ${grown.score} (계정 24 → ${grown.totalCount})`,
  );
  check(
    'b2 투영 before가 하락한 종합을 따라감',
    grown.recovery.beforeComposite === grown.score,
    `before=${grown.recovery.beforeComposite} · 종합=${grown.score} (시드 고정이면 24로 굳는다)`,
  );
  check(
    'b3 투영 after도 기준선과 달라짐',
    grown.recovery.afterComposite !== base.recovery.afterComposite,
    `${base.recovery.afterComposite} → ${grown.recovery.afterComposite}`,
  );

  // (c) 큐 밖 계정을 지워 after를 부풀리지 않는다 — 신규 15개는 큐에 없으므로
  //     after가 100 근처로 튀면 전삭제 회귀(07-15 B1)다.
  check(
    'c  전삭제 회귀 없음',
    (grown.recovery.afterComposite ?? 100) < 100,
    `after=${grown.recovery.afterComposite} (100이면 큐 밖까지 지운 것)`,
  );

  // (d) 정리 큐를 비우면 회복 여지가 사라진다 — 삭제 표적이 데이터에서 온다는 증거
  await prisma.cleanupRequest.deleteMany({
    where: { userId: TEST_USER_ID, status: { in: ['queued', 'in_progress'] } },
  });
  const emptied = await getScoreForUser(TEST_USER_ID);
  check(
    'd  큐 비우면 after 하락',
    (emptied.recovery.afterComposite ?? 0) < (grown.recovery.afterComposite ?? 0),
    `큐 있음 ${grown.recovery.afterComposite} → 큐 없음 ${emptied.recovery.afterComposite}`,
  );

  console.log('');
  console.log(failures === 0 ? '결과: 전 항목 PASS' : `결과: ${failures}건 FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
