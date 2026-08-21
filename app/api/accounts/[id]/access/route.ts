// GET /api/accounts/[id]/access — 계정 접속기록.
//
// 세션 필수 + 소유권 검증(IDOR 차단: 본인 계정만). Next 16: 동적 params는 Promise → await 필요.
// 빌드타임 DB 접속 금지 → force-dynamic.
//
// 2026-08-21: 합성 폴백(`synth`)을 제거했다.
//   로그가 0건이면 "서울, KR / Chrome / Windows"와 "미상 / Unknown" 두 줄을 지어내
//   돌려주고 있었다. 화면 호출자가 없어 무대에는 안 보였지만 라우트는 살아 있었고,
//   인증만 통과하면 누구에게나 남의 이력처럼 보이는 기록을 응답했다.
//   08-18에 `/api/guard` 스텁에서 걷어낸 것과 같은 종류다.
//
//   특히 이상접속축을 "아직 확인된 접속 기록이 없어요"로 표기하기로 한 판단과
//   이 코드가 정면으로 어긋났다. 화면은 없다고 말하는데 API는 있다고 답하는 상태였다.
//
//   시드 상수 폴백도 함께 걷었다. 시드 계정의 기록도 DB에 있으므로 실쿼리로 닿는다.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import type { ApiEnvelope, AccessLogDTO } from '@/lib/api-types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 소유권 검증(IDOR 차단): 본인(userId) 소속 계정만 조회 허용.
    const account = await prisma.account.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!account) {
      return Response.json({ error: 'account not found' }, { status: 404 });
    }

    const logs = await prisma.accessLog.findMany({
      where: { accountId: id },
      orderBy: { timestamp: 'desc' },
    });

    // 0건이면 빈 배열이다. "기록이 없다"와 "기록을 못 봤다"는 화면이 구분해 말할 몫이고,
    // 어느 쪽이든 없는 접속을 만들어 내는 것보다 낫다.
    const data: AccessLogDTO[] = logs.map((l) => ({
      id: l.id,
      timestamp: l.timestamp.toISOString(),
      location: l.location,
      device: l.device,
      suspicious: l.suspicious,
    }));

    const body: ApiEnvelope<AccessLogDTO[]> = { data };
    return Response.json(body);
  } catch (e) {
    // DB 미연결. 예전에는 여기서 시드로 합성해 돌려줬는데, 그러면 장애가 정상처럼 보인다.
    // 접속기록은 화면이 없어도 되는 정보이므로 실패를 실패로 알린다.
    console.warn('[api/accounts/access] DB unavailable:', (e as Error).message);
    return Response.json({ error: '접속기록을 불러오지 못했습니다.' }, { status: 502 });
  }
}
