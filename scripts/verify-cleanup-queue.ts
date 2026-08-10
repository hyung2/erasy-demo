// 런타임 실측 — 정리 큐 담기가 회복 투영에 실제로 반영되는지 회귀 가드. 실제 DB 대상.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-cleanup-queue.ts
//
// 무엇을 지키는가
//   회복 투영은 **미완료 정리 요청**만 삭제 표적으로 삼는다(score-service의 hasPendingRemoval).
//   화면에는 "선택 일괄 정리"·"요청 접수"가 있었지만 둘 다 로컬 state만 바꿔서, 사용자가 무엇을
//   담아도 서버 큐는 비어 있었고 투영 도착점이 낮게 고정됐다(2026-08-10 배선 전).
//   이 가드는 담기→투영 상승→빼기→원복의 왕복이 끊기지 않았는지 잰다.
//
// 검증 항목
//   (a) 담기 전 기준선 — 큐가 비면 회복 여지도 없다
//   (b) 담으면 투영 도착점 상승 · **현재 점수는 그대로**(담기는 정리가 아니다)
//   (c) 멱등 — 같은 계정을 다시 담아도 큐가 부풀지 않는다
//   (d) 소유권 — 남의 계정 id는 담기지 않고 notFound로 잡힌다(IDOR)
//   (e) actionType 파생 — OAuth 계정은 revoke, 자체 가입은 delete. **둘 다 투영 표적으로 인정**
//   (f) 빼기 — 큐에서 빼면 투영 도착점이 원복된다
//   (g) 완료된 요청은 빼기로 지워지지 않는다(한 일의 이력)
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유). 시크릿 미출력.
import { prisma } from '../lib/prisma';
import { provisionDemoData, purgeProvisionedData } from '../lib/provision-demo';
import { getScoreForUser } from '../lib/score-service';
import { enqueue, dequeue, listQueue } from '../lib/cleanup-queue';

const TEST_USER_ID = 'verify-cleanup-queue-tmp';
const OTHER_USER_ID = 'verify-cleanup-queue-other';
const DAY = 86_400_000;

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

async function cleanup() {
  for (const id of [TEST_USER_ID, OTHER_USER_ID]) {
    await purgeProvisionedData(prisma, id);
    await prisma.user.deleteMany({ where: { id } });
  }
}

/** 투영 도착점. 큐에 담은 정리를 끝냈을 때 도달하는 점수. */
async function projection(userId: string) {
  const s = await getScoreForUser(userId);
  return {
    now: s.score,
    after: s.recovery.afterComposite ?? 0,
    before: s.recovery.beforeComposite ?? 0,
  };
}

async function main() {
  await cleanup();
  for (const id of [TEST_USER_ID, OTHER_USER_ID]) {
    await prisma.user.create({
      data: { id, email: `${id}@example.invalid`, name: '정리큐 검증' },
    });
    await provisionDemoData(prisma, id, { idPrefix: `u${id}` });
  }

  // 시드에는 이미 정리 큐가 들어 있다(페르소나 김민준). 이 가드는 "새로 담는 것"의 효과를
  // 재야 하므로 미완료분을 비우고 시작한다 — 기준선이 흔들리면 상승폭이 무엇 때문인지 모른다.
  await prisma.cleanupRequest.deleteMany({
    where: { userId: TEST_USER_ID, status: { in: ['queued', 'in_progress'] } },
  });

  // 방치 계정 12개(2년+ 미사용). 절반은 OAuth 연결, 절반은 자체 가입 — actionType 양쪽 경로.
  await prisma.account.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      userId: TEST_USER_ID,
      name: `방치서비스${i}`,
      provider: i % 2 === 0 ? ('google' as const) : ('manual' as const),
      category: 'unknown' as const,
      source: 'mail_scan' as const,
      discovered: true,
      acknowledgedAt: new Date(), // 확인은 끝난 상태 — 미인지 인자를 변수에서 제거한다
      lastUsedAt: new Date(Date.now() - 900 * DAY),
    })),
  });
  const targets = await prisma.account.findMany({
    where: { userId: TEST_USER_ID, name: { startsWith: '방치서비스' } },
    select: { id: true, provider: true },
  });

  // (a) 기준선 — 큐가 비었으면 회복 여지도 그만큼 작다
  const base = await projection(TEST_USER_ID);
  const emptyQueue = await listQueue(prisma, TEST_USER_ID);
  check(
    'a  기준선 — 큐 비어 있음',
    emptyQueue.filter((q) => q.status === 'queued').length === 0,
    `현재 ${base.now} · 투영 도착점 ${base.after}`,
  );

  // (b) 담기 → 투영 상승, 현재 점수 불변
  const res = await enqueue(prisma, TEST_USER_ID, targets.map((t) => t.id));
  const queued = await projection(TEST_USER_ID);
  check(
    'b1 담긴 건수 = 대상 전체',
    res.queued === targets.length && res.notFound === 0,
    `${res.queued}건 담김 (notFound ${res.notFound})`,
  );
  check(
    'b2 투영 도착점 상승',
    queued.after > base.after,
    `${base.after} → ${queued.after} (담아 둔 정리를 끝냈을 때)`,
  );
  check(
    'b3 현재 점수는 그대로',
    queued.now === base.now,
    `${base.now} 유지 — 담기는 정리가 아니다(정직 가드)`,
  );

  // (c) 멱등 — 같은 계정 재담기
  const again = await enqueue(prisma, TEST_USER_ID, targets.map((t) => t.id));
  const rowsAfterRetry = await prisma.cleanupRequest.count({
    where: { userId: TEST_USER_ID, status: 'queued' },
  });
  check(
    'c  멱등 — 재담기 무증가',
    again.queued === 0 && again.alreadyQueued === targets.length && rowsAfterRetry === targets.length,
    `신규 ${again.queued} · 기존 ${again.alreadyQueued} · 큐 행 ${rowsAfterRetry}`,
  );

  // (d) 소유권 — 남의 계정 id는 담기지 않는다
  const otherAccounts = await prisma.account.findMany({
    where: { userId: OTHER_USER_ID },
    select: { id: true },
    take: 5,
  });
  const idor = await enqueue(prisma, TEST_USER_ID, otherAccounts.map((a) => a.id));
  const leaked = await prisma.cleanupRequest.count({
    where: { userId: TEST_USER_ID, accountId: { in: otherAccounts.map((a) => a.id) } },
  });
  check(
    'd  소유권 — 남의 계정 차단',
    idor.queued === 0 && idor.notFound === otherAccounts.length && leaked === 0,
    `담김 ${idor.queued} · notFound ${idor.notFound} · 교차 생성 ${leaked}건`,
  );

  // (e) actionType 파생 + 투영 표적 인정
  const created = await prisma.cleanupRequest.findMany({
    where: { userId: TEST_USER_ID, status: 'queued' },
    include: { account: { select: { provider: true } } },
  });
  const derivedOk = created.every((c) =>
    c.account.provider === 'manual' ? c.actionType === 'delete' : c.actionType === 'revoke',
  );
  const revokeCount = created.filter((c) => c.actionType === 'revoke').length;
  const deleteCount = created.filter((c) => c.actionType === 'delete').length;
  check(
    'e1 actionType 파생 정합',
    derivedOk && revokeCount > 0 && deleteCount > 0,
    `revoke ${revokeCount} · delete ${deleteCount} (OAuth=연결 해제, 자체 가입=삭제)`,
  );

  // revoke만 남겼을 때도 투영이 오르는지 — 표적 집합(REMOVAL_ACTIONS)이 score-service의
  //   hasPendingRemoval과 어긋나면 여기서 잡힌다. 한쪽만 바꾸면 큐는 쌓이는데 점수는 안 움직인다.
  const manualIds = targets.filter((t) => t.provider === 'manual').map((t) => t.id);
  await dequeue(prisma, TEST_USER_ID, manualIds);
  const revokeOnly = await projection(TEST_USER_ID);
  check(
    'e2 revoke 단독도 투영 표적',
    revokeOnly.after > base.after,
    `delete 제외 후에도 ${base.after} → ${revokeOnly.after}`,
  );

  // (f) 빼기 → 원복. 큐를 비우면 회복 여지도 사라진다.
  const removed = await dequeue(prisma, TEST_USER_ID, targets.map((t) => t.id));
  const emptied = await projection(TEST_USER_ID);
  check(
    'f  빼기 → 투영 원복',
    emptied.after === base.after,
    `${queued.after} → ${emptied.after} (기준선 ${base.after}), 제거 ${removed.removed}건`,
  );

  // (g) 완료된 요청은 빼기로 지워지지 않는다
  const doneTarget = targets[0].id;
  await prisma.cleanupRequest.create({
    data: {
      userId: TEST_USER_ID,
      accountId: doneTarget,
      actionType: 'revoke',
      status: 'done',
      completedAt: new Date(),
    },
  });
  const removeDone = await dequeue(prisma, TEST_USER_ID, [doneTarget]);
  const doneRows = await prisma.cleanupRequest.count({
    where: { userId: TEST_USER_ID, accountId: doneTarget, status: 'done' },
  });
  check(
    'g  완료 이력 보존',
    removeDone.removed === 0 && doneRows === 1,
    `빼기 대상 ${removeDone.removed}건 · 완료 이력 ${doneRows}건 유지`,
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
