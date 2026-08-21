// POST /api/breach/resolve — 유출 건에 "조치했다"를 표시한다.
//
// 왜 필요한가: 화면은 오래도록 "조치 완료된 항목" 구역을 갖고 있었지만 **그 상태로 가는
// 길이 없었다.** 유출을 찾아내면 감점만 되고 되돌릴 수 없었다는 뜻이고, 그건 회복 경로
// 없는 감점이다. 08-05에 S축에서 같은 구조를 한 번 걷어냈다(확인해도 안 내려가던 미인지 신호).
//
// 되돌리기도 함께 넣는다(DELETE). 잘못 눌렀을 때 되돌릴 수 없으면 사용자는 누르기를
// 주저하고, 그러면 회복 경로가 있으나 마나가 된다(08-10 정리 큐에서 같은 판단).
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';

async function setResolved(id: unknown, resolved: boolean) {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ ok: false, error: sessionUser.message }, { status: sessionUser.status });
  }
  if (typeof id !== 'string' || id.length === 0) {
    return Response.json({ ok: false, error: '대상이 지정되지 않았습니다.' }, { status: 400 });
  }

  try {
    // 소유권 경계: updateMany + userId 조건. findUnique 후 검사하면 남의 건을 조회한 뒤
    // 거절하는 모양이 되고, 조건을 빠뜨리면 그대로 IDOR가 된다.
    const res = await prisma.breach.updateMany({
      where: { id, userId: sessionUser.userId },
      data: { resolved },
    });
    if (res.count === 0) {
      return Response.json({ ok: false, error: '해당 항목을 찾을 수 없습니다.' }, { status: 404 });
    }
    return Response.json({ ok: true, data: { id, resolved } });
  } catch (e) {
    console.error('[breach/resolve] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  return setResolved(body.id, true);
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  return setResolved(body.id, false);
}
