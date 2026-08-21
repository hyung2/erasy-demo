// GET /api/guard — 실시간 가드(활동 피드 + 유출 이력). **이 사용자 데이터만** 조회한다.
//
// 예전에는 dummy-data를 그대로 돌려주는 stub이었다(_stub:true). userId를 받지도 않아서,
// 방금 가입한 사람 화면에도 "3개 계정에서 유출 정황이 발견되었습니다 · Quora 2018-12"가 떴다.
// 심사위원이 각자 계정으로 들어오는 화면이라 남의 유출을 자기 것으로 읽게 둘 수 없다(2026-08-18).
//
// H2: 세션 게이트 필수. 빌드타임 실행 방지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { buildActivityFeed } from '@/lib/activity';
import type { ApiEnvelope, GuardDTO, BreachDTO } from '@/lib/api-types';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 소유권 경계: where userId 스코핑(IDOR 차단).
    const [rows, alerts, user] = await Promise.all([
      prisma.breach.findMany({
        where: { userId },
        orderBy: [{ resolved: 'asc' }, { breachDate: 'desc' }],
      }),
      buildActivityFeed(prisma, userId),
      prisma.user.findUnique({ where: { id: userId }, select: { breachCheckedAt: true } }),
    ]);

    const breaches: BreachDTO[] = rows.map((b) => ({
      id: b.id,
      service: b.service,
      // 저장은 DateTime, 화면 표기는 월 단위. 없는 정밀도를 지어내지 않는다.
      breachDate: b.breachDate.toISOString().slice(0, 7),
      exposedFields: b.exposedFields,
      advice: b.advice,
      severity: b.severity,
      resolved: b.resolved,
    }));

    const data: GuardDTO = {
      alerts,
      breaches,
      breachCheckedAt: user?.breachCheckedAt?.toISOString() ?? null,
    };
    return Response.json({ data } satisfies ApiEnvelope<GuardDTO>);
  } catch (e) {
    // DB 미연결 — 남의 데이터로 채우느니 빈 상태를 준다. 화면이 "아직 없다"고 말하는 편이
    // 지어낸 유출 목록보다 낫다.
    console.warn('[api/guard] DB unavailable:', (e as Error).message);
    return Response.json(
      { error: '알림을 불러오지 못했습니다.' },
      { status: 502 },
    );
  }
}
