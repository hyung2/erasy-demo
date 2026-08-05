// POST /api/accounts/acknowledge — 발견 계정 확인 처리.
//
// 무엇을 하는가: 아직 확인하지 않은 발견 계정(`discovered ∧ acknowledgedAt IS NULL`)에
// 확인 시각을 남긴다. S축 "미인지" 인자(p=0.03)가 빠져 점수가 오른다.
//
// 왜 이게 회복인가: 그 인자가 재는 위험은 "계정이 있다는 사실을 모른다"는 것이다(투명설계안 v2 3.2).
// 화면으로 보여준 뒤에도 감점이 남으면 이미 사라진 위험을 계속 세는 셈이고, 발견이 주 수집
// 경로가 된 뒤에는 "계정을 많이 찾을수록 감점"이 되어 불변 원칙 "규모 무감점"을 깬다.
// **계정 자체의 위험(방치·유출·위생)은 그대로 남는다** — 그건 정리해야 사라진다.
//
// 왜 일괄인가: 발견 수십 건을 하나씩 누르게 하면 07-29에 뒤집은 "확인 노동 전가"가 부활한다.
// 사용자가 목록을 본 시점이 곧 인지 시점이므로, 한 번의 확인으로 그 시점을 기록한다.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';

export async function POST() {
  // 세션만 보고 쓰면 User 행이 없을 때 조용히 0건 처리되고 화면은 성공으로 보인다.
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ ok: false, error: sessionUser.message }, { status: sessionUser.status });
  }

  try {
    const res = await prisma.account.updateMany({
      // 소유권 경계: 세션 userId 스코프. 이미 확인한 건은 시각을 덮지 않는다(최초 인지 시점 보존).
      where: { userId: sessionUser.userId, discovered: true, acknowledgedAt: null },
      data: { acknowledgedAt: new Date() },
    });

    return Response.json({ ok: true, data: { acknowledged: res.count } });
  } catch (e) {
    console.error('[accounts/acknowledge] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '확인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}
