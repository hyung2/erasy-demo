// /api/cleanup/requests — 정리 큐 담기(POST) · 조회(GET) · 빼기(DELETE).
//
// 무엇을 하는가: 사용자가 고른 계정에 정리 요청(CleanupRequest)을 만든다. 회복 투영은 이미
// **미완료 정리 요청**을 삭제 표적으로 삼아 계산하므로(lib/score-service.ts hasPendingRemoval),
// 큐에 담기는 순간 "정리하면 여기까지 옵니다"가 그만큼 올라간다.
//
// 왜 이 라우트가 필요했는가: 화면에는 "선택 일괄 정리"·"요청 접수" 버튼이 이미 있었지만
// 둘 다 로컬 state만 바꿨고(`requested`·`markCleaned`), POST /api/cleanup/mark는 스텁이었다.
// 그래서 실사용자의 큐는 늘 비어 있었고 투영 도착점이 낮게 고정됐다 — 화면은 정리를 접수했다고
// 말하는데 서버는 아무것도 담고 있지 않은 상태였다(2026-08-10 배선).
//
// 이 파일은 세션 게이트와 입력 검증만 진다. 도메인 규칙(소유권·멱등·actionType 파생)은
// lib/cleanup-queue에 있고, 검증 스크립트가 같은 함수를 직접 호출해 잰다.
//
// 정직성: 실제 연결 해제·계정 삭제를 대행하지 않는다. 이건 "사용자가 정리하기로 한 목록"이며
// 화면 문구도 요청 접수까지만 약속한다. 구현하지 않은 동작을 문구로 약속하지 않는다.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';
import { enqueue, dequeue, listQueue, MAX_BATCH } from '@/lib/cleanup-queue';
import type {
  ApiEnvelope,
  CleanupQueueItemDTO,
  CleanupQueueRequest,
  CleanupQueueResponse,
  CleanupQueueRemoveResponse,
} from '@/lib/api-types';

/** 요청 본문에서 accountIds 회수. 형식 오류는 빈 배열로 뭉개지 않고 null로 구분한다. */
async function readIds(request: Request): Promise<string[] | null> {
  let body: Partial<CleanupQueueRequest>;
  try {
    body = (await request.json()) as Partial<CleanupQueueRequest>;
  } catch {
    return null;
  }
  if (!Array.isArray(body.accountIds)) return null;
  return body.accountIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

// ── GET: 이 사용자의 정리 큐 ──
// 화면이 "담김" 상태를 새로고침 뒤에도 표시하려면 서버가 정본이어야 한다. 로컬 state만으로는
// 탭을 닫는 순간 사라져, 담아 둔 사실과 화면이 어긋난다.
export async function GET() {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ error: sessionUser.message }, { status: sessionUser.status });
  }

  try {
    const data = await listQueue(prisma, sessionUser.userId);
    return Response.json({ data } satisfies ApiEnvelope<CleanupQueueItemDTO[]>);
  } catch (e) {
    console.error('[cleanup/requests GET] failed:', (e as Error).message);
    // 빈 배열로 폴백하면 "담은 게 없다"로 읽혀 사용자가 다시 담는다(중복 담기 유도).
    // 못 가져왔으면 못 가져왔다고 말한다.
    return Response.json({ error: '정리 목록을 불러오지 못했습니다.' }, { status: 502 });
  }
}

// ── POST: 큐에 담기(일괄·멱등) ──
export async function POST(request: Request) {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ error: sessionUser.message }, { status: sessionUser.status });
  }

  const ids = await readIds(request);
  if (ids === null) {
    return Response.json({ error: 'accountIds 배열이 필요합니다.' }, { status: 400 });
  }
  if (ids.length === 0) {
    return Response.json({ error: '담을 계정을 선택해 주세요.' }, { status: 400 });
  }
  // 상한 초과를 조용히 자르면 잘린 줄 모르고 "전부 담았다"고 믿게 된다.
  if (ids.length > MAX_BATCH) {
    return Response.json(
      { error: `한 번에 최대 ${MAX_BATCH}건까지 담을 수 있습니다.` },
      { status: 400 },
    );
  }

  try {
    const data = await enqueue(prisma, sessionUser.userId, ids);
    return Response.json({ data } satisfies ApiEnvelope<CleanupQueueResponse>, { status: 201 });
  } catch (e) {
    console.error('[cleanup/requests POST] failed:', (e as Error).message);
    return Response.json(
      { error: '정리 목록에 담지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}

// ── DELETE: 큐에서 빼기(미완료분만) ──
export async function DELETE(request: Request) {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ error: sessionUser.message }, { status: sessionUser.status });
  }

  const ids = await readIds(request);
  if (ids === null) {
    return Response.json({ error: 'accountIds 배열이 필요합니다.' }, { status: 400 });
  }
  if (ids.length === 0) {
    return Response.json({ error: '뺄 계정을 선택해 주세요.' }, { status: 400 });
  }

  try {
    const data = await dequeue(prisma, sessionUser.userId, ids);
    return Response.json({ data } satisfies ApiEnvelope<CleanupQueueRemoveResponse>);
  } catch (e) {
    console.error('[cleanup/requests DELETE] failed:', (e as Error).message);
    return Response.json(
      { error: '정리 목록에서 빼지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}
