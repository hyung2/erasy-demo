// GET /api/cron/breach-rescan — 정기 자동 유출 대조. Vercel 크론이 부른다.
//
// 인증
//   CRON_SECRET이 설정돼 있으면 `Authorization: Bearer <값>`을 요구한다. Vercel 크론이
//   그 헤더를 붙여 보낸다.
//
//   **설정돼 있지 않으면 비교를 건너뛴다 — 통과시키는 것이 아니라, 비교할 것이 없다는
//   사실을 인정하는 것이다.** 비어 있는 값과 대조하면 `Bearer undefined`가 정답이 되어
//   아무나 통과한다. 그건 인증이 있는 척하면서 없는 상태다.
//
//   비밀값이 없어도 이 경로가 위험하지 않은 이유는 따로 있다. 비용을 정하는 것은 호출
//   횟수가 아니라 **마지막 대조로부터 지난 시간**이고, 그 사실은 DB에 있다(breach-rescan의
//   간격 게이트). 아무리 자주 불러도 20시간 안에는 같은 사람을 다시 조회하지 않는다.
//   그래도 비밀값을 넣는 편이 낫다 — 남이 우리 크론을 마음대로 당기게 둘 이유는 없다.
export const dynamic = 'force-dynamic';

import { rescanDueUsers } from '@/lib/breach-rescan';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('authorization');
    if (header !== `Bearer ${secret}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await rescanDueUsers();
    // 사용자 이메일은 로그에 남기지 않는다. 몇 명을 봤고 몇 건이 늘었는지면 충분하다.
    console.log('[cron/breach-rescan]', JSON.stringify(result));
    return Response.json({ data: { ...result, authenticated: Boolean(secret) } });
  } catch (e) {
    console.error('[cron/breach-rescan] 실패:', (e as Error).message);
    return Response.json({ error: 'rescan failed' }, { status: 500 });
  }
}
