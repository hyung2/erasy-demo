// GET /api/accounts/[id]/access — 계정 접속기록. 실+시드 하이브리드(T2.3).
//  세션 필수 + 소유권 검증(IDOR 차단: 본인 계정만). Prisma 실쿼리, 로그 0건/시드 id/DB 미연결 시 합성 폴백.
//  Next 16: 동적 params는 Promise → await 필요. 빌드타임 DB 접속 금지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import type { ApiEnvelope, AccessLogDTO } from '@/lib/api-types';
import { accounts as seed } from '@/lib/dummy-data';

// 합성 접속기록(2건) — 실데이터 없을 때의 데모 폴백.
function synth(id: string, breached: boolean): AccessLogDTO[] {
  const now = Date.now();
  return [
    {
      id: `${id}-log1`,
      timestamp: new Date(now - 86_400_000).toISOString(),
      location: '서울, KR',
      device: 'Chrome / Windows',
      suspicious: false,
    },
    {
      id: `${id}-log2`,
      timestamp: new Date(now - 86_400_000 * 30).toISOString(),
      location: '미상',
      device: 'Unknown',
      suspicious: breached,
    },
  ];
}

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
      select: { id: true, breached: true },
    });

    if (account) {
      const logs = await prisma.accessLog.findMany({
        where: { accountId: id },
        orderBy: { timestamp: 'desc' },
      });
      const data: AccessLogDTO[] =
        logs.length > 0
          ? logs.map((l) => ({
              id: l.id,
              timestamp: l.timestamp.toISOString(),
              location: l.location,
              device: l.device,
              suspicious: l.suspicious,
            }))
          : synth(id, account.breached); // 실계정이나 로그 미적재 → 합성 폴백

      const body: ApiEnvelope<AccessLogDTO[]> = { data };
      return Response.json(body);
    }

    // DB에 없으면 시드 계정 id인지 확인(폴백 데모).
    const s = seed.find((a) => a.id === id);
    if (s) {
      const body: ApiEnvelope<AccessLogDTO[]> = { data: synth(id, s.breached) };
      return Response.json(body);
    }
    return Response.json({ error: 'account not found' }, { status: 404 });
  } catch (e) {
    // DB 미연결 → 시드 id면 합성 폴백, 아니면 검증 불가로 404.
    console.warn('[api/accounts/access] DB unavailable, seed fallback:', (e as Error).message);
    const s = seed.find((a) => a.id === id);
    if (s) {
      const body: ApiEnvelope<AccessLogDTO[]> = { data: synth(id, s.breached) };
      return Response.json(body);
    }
    return Response.json({ error: 'account not found' }, { status: 404 });
  }
}
