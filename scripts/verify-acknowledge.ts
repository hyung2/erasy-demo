// 런타임 실측 — 발견 확인이 S축 "미인지" 인자를 해제하는지 회귀 가드. 실제 DB 대상.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-acknowledge.ts
//
// 무엇을 지키는가
//   투명설계안 v2 불변 원칙 **"규모 무감점 — 계정 수 자체는 감점 안 함"**.
//   A1(개방 모드) 이후 발견이 주 수집 경로가 되면서 모든 발견 계정에 `discovered`가 붙고,
//   그 인자가 해제되지 않아 **계정을 많이 찾을수록 점수가 내려가는** 역전이 생겼다
//   (2026-08-05 실측: 미인지 인자 하나가 surface의 83%를 깎음). 확인 시 해제로 해소.
//
// 검증 항목
//   (a) 발견 계정 30개 추가 → 점수 하락(미인지 인자 적용됨)
//   (b) 확인 처리 → **점수 회복**, surface 축 상승
//   (c) 회복 후에도 계정 수는 그대로 — 확인은 계정을 지우지 않는다
//   (d) 휴면 계정의 감점은 확인해도 남는다 — 계정 자체의 위험은 정리해야 사라진다
//   (e) 재확인은 최초 인지 시각을 덮지 않는다(멱등)
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유). 시크릿 미출력.
import { prisma } from '../lib/prisma';
import { provisionDemoData, purgeProvisionedData } from '../lib/provision-demo';
import { getScoreForUser } from '../lib/score-service';

const TEST_USER_ID = 'verify-acknowledge-tmp';
const DAY = 86_400_000;

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
    data: { id: TEST_USER_ID, email: `${TEST_USER_ID}@example.invalid`, name: '확인 검증' },
  });
  await provisionDemoData(prisma, TEST_USER_ID, { idPrefix: `u${TEST_USER_ID}` });

  const base = await getScoreForUser(TEST_USER_ID);

  // (a) 발견 계정 30개 — 절반은 휴면(730일+), 절반은 활성. 메일 스캔 저장 형태.
  await prisma.account.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      userId: TEST_USER_ID,
      name: `발견서비스${i}`,
      provider: 'manual' as const,
      category: 'unknown' as const,
      source: 'mail_scan' as const,
      discovered: true,
      lastUsedAt: new Date(Date.now() - (i % 2 === 0 ? 900 : 30) * DAY),
    })),
  });

  const found = await getScoreForUser(TEST_USER_ID);
  check(
    'a  발견 직후 점수 하락',
    found.score < base.score,
    `${base.score} → ${found.score} (미인지 인자 적용)`,
  );
  const surfaceFound = found.axes.surface.score ?? 0;

  // (b) 확인 처리
  const acked = await prisma.account.updateMany({
    where: { userId: TEST_USER_ID, discovered: true, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  const after = await getScoreForUser(TEST_USER_ID);
  const surfaceAfter = after.axes.surface.score ?? 0;

  // 시드에도 미인지 계정이 있으므로(김민준 3건) 신규 30 + 시드분이 함께 처리된다.
  const seedDiscovered = await prisma.account.count({
    where: { userId: TEST_USER_ID, source: 'seed', discovered: true },
  });
  check(
    'b1 확인 건수 = 신규 30 + 시드 미인지',
    acked.count === 30 + seedDiscovered,
    `${acked.count}건 (신규 30 + 시드 ${seedDiscovered})`,
  );
  check(
    'b2 확인 후 점수 회복',
    after.score > found.score,
    `${found.score} → ${after.score} (미인지 인자 해제)`,
  );
  check(
    'b3 surface 축 상승',
    surfaceAfter > surfaceFound,
    `${surfaceFound.toFixed(1)} → ${surfaceAfter.toFixed(1)}`,
  );

  // (c) 확인은 계정을 지우지 않는다
  check(
    'c  계정 수 불변',
    after.totalCount === found.totalCount,
    `${found.totalCount}개 유지 (확인은 삭제가 아니다)`,
  );

  // (d) 계정 자체의 위험은 남는다 — 휴면 15개가 있으므로 시드 기준선까지 완전 복귀하면 안 된다.
  check(
    'd  휴면 감점은 잔존',
    surfaceAfter < (base.axes.surface.score ?? 100),
    `확인 후 ${surfaceAfter.toFixed(1)} < 기준선 ${(base.axes.surface.score ?? 0).toFixed(1)} (방치는 정리해야 사라진다)`,
  );

  // (e) 재확인 멱등 — 최초 인지 시각을 덮지 않는다
  const before = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, discovered: true },
    select: { acknowledgedAt: true },
  });
  const second = await prisma.account.updateMany({
    where: { userId: TEST_USER_ID, discovered: true, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  const afterSecond = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, discovered: true },
    select: { acknowledgedAt: true },
  });
  check(
    'e  재확인 멱등',
    second.count === 0 &&
      before?.acknowledgedAt?.getTime() === afterSecond?.acknowledgedAt?.getTime(),
    `추가 처리 ${second.count}건, 최초 인지 시각 보존`,
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
