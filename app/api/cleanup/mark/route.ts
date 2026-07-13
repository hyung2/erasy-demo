// POST /api/cleanup/mark — 정리 상태 전이 (stub: 입력 에코, _stub:true).
// W4: prisma.cleanupRequest upsert + status 전이(queued/in_progress/done/failed) + completedAt 기록으로 교체.
//   실구현 시 accountId 소유권 검증(userId 소속) 필수 + CSRF(same-origin/토큰) 반영.
// H2: 세션 게이트 필수. 빌드타임 실행 방지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 경계 검증: 사용자 입력이므로 파싱·필수값·enum 검증.
  let body: Partial<CleanupMarkRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }

  const { accountId, status } = body;
  if (!accountId || !status || !VALID_STATUS.includes(status)) {
    return Response.json(
      { error: 'accountId and valid status are required' },
      { status: 400 },
    );
  }

  // 스텁: 실제 전이 없이 에코. completedAt은 done일 때만 세팅.
  const data: CleanupMarkResponse = {
    id: `stub-${accountId}`,
    status,
    completedAt: status === 'done' ? new Date().toISOString() : null,
  };

  const envelope: ApiEnvelope<CleanupMarkResponse> = { data, _stub: true };
  return Response.json(envelope);
}
