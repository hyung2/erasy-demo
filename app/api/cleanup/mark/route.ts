// POST /api/cleanup/mark — 정리 상태 전이(담긴 요청을 완료로 넘긴다).
//
// 이 라우트가 비어 있던 동안 제품의 절반이 닫히지 않았다. 큐에 담기는 되는데 **완료로 갈 길이
// 없어서**, 회복 규칙(score-v2의 removed → 전 축에서 계정 제외)이 한 번도 발화하지 못했다.
// 그래서 화면은 늘 "정리하면 76점이 될 예정"에서 멈췄다.
//
// 담지 않고 바로 완료도 허용한다: 사용자가 큐를 거치지 않고 제공사 화면에서 먼저 끊고 오는
// 경우가 실제 동선이다. 요청 행이 없으면 만들어서 done으로 둔다 — 한 일을 기록에서 빠뜨리지 않는다.
//
// 소유권: accountId가 이 사용자 것인지 먼저 확인한다. 남의 계정 id를 넣어도 404로 끝나며,
//   존재 여부를 알려 주지 않는다(열거 방지).
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { PENDING_STATUSES } from '@/lib/cleanup-queue';
import type {
  ApiEnvelope,
  CleanupMarkRequest,
  CleanupMarkResponse,
} from '@/lib/api-types';

const VALID_STATUS: CleanupMarkRequest['status'][] = [
  'queued',
  'in_progress',
  'done',
  'failed',
];

// 스키마 ActionType 전체. 여기 없는 값이 들어오면 Prisma가 런타임에 터지고, 그 시점엔
// 사용자가 이미 정리를 마친 뒤라 "했는데 반영이 안 됨"이 된다 — 경계에서 거른다.
const VALID_ACTION: CleanupMarkRequest['actionType'][] = [
  'password_change',
  'delete',
  'revoke',
  'logout_sessions',
  'unsubscribe',
];

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Partial<CleanupMarkRequest>;
  try {
    body = (await request.json()) as Partial<CleanupMarkRequest>;
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }

  const { accountId, status, actionType } = body;
  if (!accountId || !status || !VALID_STATUS.includes(status)) {
    return Response.json(
      { error: 'accountId and valid status are required' },
      { status: 400 },
    );
  }
  if (!actionType || !VALID_ACTION.includes(actionType)) {
    return Response.json({ error: 'valid actionType is required' }, { status: 400 });
  }

  try {
    // 소유권 경계 — 이 사용자 소유가 아니면 여기서 끝난다.
    const account = await prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!account) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }

    const completedAt = status === 'done' ? new Date() : null;

    // 담아 둔 요청이 있으면 그걸 넘긴다. 같은 계정에 같은 행동이 여러 번 담기는 일은
    // enqueue가 막지만, 과거 데이터에 중복이 있어도 가장 최근 것 하나만 전이시킨다.
    const pending = await prisma.cleanupRequest.findFirst({
      where: {
        userId,
        accountId,
        actionType,
        status: { in: [...PENDING_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const row = pending
      ? await prisma.cleanupRequest.update({
          where: { id: pending.id },
          data: { status, completedAt },
          select: { id: true, status: true, completedAt: true },
        })
      : await prisma.cleanupRequest.create({
          // 담지 않고 바로 정리한 경우 — 기록을 남긴다.
          data: { userId, accountId, actionType, status, completedAt },
          select: { id: true, status: true, completedAt: true },
        });

    const data: CleanupMarkResponse = {
      id: row.id,
      status: row.status as CleanupMarkResponse['status'],
      completedAt: row.completedAt?.toISOString() ?? null,
    };
    const envelope: ApiEnvelope<CleanupMarkResponse> = { data };
    return Response.json(envelope);
  } catch (e) {
    const err = e as Error;
    console.error('[cleanup/mark] failed:', err.message, err.stack);
    return Response.json({ error: 'mark failed' }, { status: 502 });
  }
}
