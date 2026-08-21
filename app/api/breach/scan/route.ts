// POST /api/breach/scan — 내 이메일이 어느 유출 사건에 포함됐는지 대조한다.
//
// 무엇을 하는가: HIBP breachedaccount로 조회해 Breach를 적재하고, 대조 시각을 남긴다.
//
// 왜 이게 필요한가: 유출축(가중치 0.35, 4축 중 최대)은 화면도 엔진도 완비돼 있는데
// **데이터가 들어오는 문이 없었다.** 그래서 Breach 0건 → 감점 0 → 만점이 나왔고,
// 종합 점수의 3분의 1이 근거 없이 채워져 있었다. 이 라우트가 그 문이다.
//
// 왜 GET이 아닌가: 외부 유료 API를 호출하고 DB를 쓴다. 조회처럼 보이지만 부작용이 있고,
// 프리페치나 새로고침으로 저절로 불려서는 안 된다.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';
import { syncUserBreaches } from '@/lib/breach-sync';
import { BreachLookupError, isBreachLookupConfigured } from '@/lib/hibp-breaches';

export async function POST() {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ ok: false, error: sessionUser.message }, { status: sessionUser.status });
  }

  // 키가 없으면 조회 자체가 불가능하다. 이 사실을 500으로 감추면 사용자는 "우리 서버가
  // 고장났다"로 읽고, 우리는 설정 누락을 장애로 뒤쫓게 된다.
  if (!isBreachLookupConfigured()) {
    return Response.json(
      {
        ok: false,
        error: '유출 대조 기능이 아직 연결되지 않았습니다.',
        reason: 'unconfigured',
      },
      { status: 503 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.userId },
    select: { email: true },
  });
  if (!user?.email) {
    return Response.json(
      { ok: false, error: '대조할 이메일 주소를 찾을 수 없습니다.' },
      { status: 400 },
    );
  }

  try {
    const result = await syncUserBreaches(sessionUser.userId, user.email);
    return Response.json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof BreachLookupError) {
      const status = e.kind === 'rate_limited' ? 429 : e.kind === 'unauthorized' ? 503 : 502;
      // 실패했을 때 breachCheckedAt을 남기지 않는 것이 중요하다. 남기면 조회하지 못한
      // 상태가 "대조 완료"로 기록되어 E축이 다시 근거 없는 만점을 준다.
      console.error('[breach/scan] lookup failed:', e.kind, e.message);
      return Response.json({ ok: false, error: e.message, reason: e.kind }, { status });
    }
    console.error('[breach/scan] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '유출 대조에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}
