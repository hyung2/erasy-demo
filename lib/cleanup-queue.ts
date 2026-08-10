// 정리 큐 도메인 로직 — 담기·빼기·조회. 라우트(app/api/cleanup/requests)와 검증 스크립트가
// **같은 코드 경로**를 공유한다.
//
// 왜 라우트에 두지 않는가: 라우트 핸들러는 세션(auth())에 묶여 있어, 검증 스크립트가 이걸
// 확인하려면 자기 서버에 HTTP로 재요청해야 한다. 서버사이드 fetch는 쿠키를 들고 가지 않아
// 401이 나고, 그러면 소유권·멱등 같은 **정작 중요한 규칙이 검증에서 빠진다**.
// userId를 인자로 받는 순수 함수로 두면 라우트는 세션 게이트만 지고, 가드는 로직을 직접 잰다.
//
// 소유권 경계: 모든 함수가 userId 스코프로만 질의한다. 남의 계정 id가 섞여 들어와도
// 조회 단계에서 사라지므로, 호출 측이 필터링을 잊어도 유출·오염이 생기지 않는다.
import type { PrismaClient, ActionType, Provider } from '@prisma/client';
import type {
  CleanupQueueItemDTO,
  CleanupQueueResponse,
  CleanupQueueRemoveResponse,
} from './api-types';

/**
 * 담기·빼기의 대상 액션. **회복 투영의 삭제 표적 판정(score-service의 hasPendingRemoval)과
 * 같은 집합이어야 한다** — 여기서 다른 actionType을 담으면 큐에는 쌓이는데 점수 투영은
 * 꿈쩍하지 않는다. 한쪽만 바꾸면 조용히 어긋나므로 가드가 이 정합을 검사한다.
 */
export const REMOVAL_ACTIONS: ActionType[] = ['delete', 'revoke'];

/** 아직 끝나지 않은 요청 = 담겨 있는 것. done은 이미 한 일이라 "담김"이 아니다. */
export const PENDING_STATUSES = ['queued', 'in_progress'] as const;

/**
 * 계정의 실제 정리 행동. OAuth로 연결된 계정은 연결을 끊는 것이고(revoke),
 * 자체 가입 계정은 탈퇴를 요청하는 것이다(delete). provider가 이미 아는 사실이라 추측이 아니다.
 */
export function actionFor(provider: Provider): ActionType {
  return provider === 'manual' ? 'delete' : 'revoke';
}

/** 한 번에 담을 수 있는 최대 건수. 상한에 걸리면 조용히 자르지 않고 호출 측이 알린다. */
export const MAX_BATCH = 300;

export async function listQueue(
  db: PrismaClient,
  userId: string,
): Promise<CleanupQueueItemDTO[]> {
  const rows = await db.cleanupRequest.findMany({
    where: { userId, actionType: { in: REMOVAL_ACTIONS } },
    include: { account: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    accountName: r.account.name,
    actionType: r.actionType as CleanupQueueItemDTO['actionType'],
    status: r.status as CleanupQueueItemDTO['status'],
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * 큐에 담기(일괄·멱등).
 *
 * 멱등인 이유: 일괄 담기를 두 번 누르면 같은 계정에 요청이 두 개 쌓인다. 투영이 같은 계정을
 * 두 번 지운 것처럼 계산할 위험도 있지만, 그보다 사용자가 "빼기"를 눌렀을 때 하나만 사라져
 * 여전히 담긴 것처럼 보이는 게 더 나쁘다.
 */
export async function enqueue(
  db: PrismaClient,
  userId: string,
  accountIds: string[],
): Promise<CleanupQueueResponse> {
  const ids = [...new Set(accountIds)];

  // 소유권 경계 — 이 사용자 소유 계정만 통과한다.
  const owned = await db.account.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, provider: true },
  });
  const notFound = ids.length - owned.length;

  const pending = await db.cleanupRequest.findMany({
    where: {
      userId,
      accountId: { in: owned.map((a) => a.id) },
      actionType: { in: REMOVAL_ACTIONS },
      status: { in: [...PENDING_STATUSES] },
    },
    select: { accountId: true },
  });
  const pendingIds = new Set(pending.map((p) => p.accountId));

  const toCreate = owned.filter((a) => !pendingIds.has(a.id));
  if (toCreate.length > 0) {
    await db.cleanupRequest.createMany({
      data: toCreate.map((a) => ({
        userId,
        accountId: a.id,
        actionType: actionFor(a.provider),
        status: 'queued' as const,
        // deepLink는 비워 둔다. 서비스별 탈퇴 경로는 lib/deep-links의 사람 검증 게이트를 거친
        // 것만 쓴다 — 여기서 URL을 지어내면 사용자를 없는 페이지로 보낸다.
      })),
    });
  }

  return {
    queued: toCreate.length,
    alreadyQueued: pendingIds.size,
    notFound,
    items: await listQueue(db, userId),
  };
}

/**
 * 큐에서 빼기(미완료분만).
 *
 * 되돌릴 수 없는 담기는 조작 실수를 복구할 방법이 없고, 리허설에서 "담기 전" 상태를 다시
 * 만들려면 DB를 직접 건드려야 한다(2026-08-05 acknowledge가 그랬다).
 * 완료(done)된 요청은 지우지 않는다 — 실제로 한 일의 이력이다.
 */
export async function dequeue(
  db: PrismaClient,
  userId: string,
  accountIds: string[],
): Promise<CleanupQueueRemoveResponse> {
  const res = await db.cleanupRequest.deleteMany({
    where: {
      userId, // 소유권 경계
      accountId: { in: [...new Set(accountIds)] },
      actionType: { in: REMOVAL_ACTIONS },
      status: { in: [...PENDING_STATUSES] },
    },
  });
  return { removed: res.count };
}
