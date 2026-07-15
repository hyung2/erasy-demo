// PATCH /api/accounts/[id] — 자가신고 신호 갱신(T5.4 기능#6).
//  세션 필수 + 소유권 검증(IDOR 차단: 본인 계정만). 부분 갱신(전 필드 선택).
//  비번값·2FA·마지막사용·미인지는 사용자 자가신고(source=user_input 계정 대상). 점수 재계산은 GET /api/score가 담당.
//  Next 16: 동적 params는 Promise → await. 빌드타임 DB 접속 금지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiEnvelope,
  AccountDTO,
  AccountUpdateRequest,
  LastUsedBucket,
} from '@/lib/api-types';

// 마지막 사용 버킷 → lastUsedAt 파생(구간 대표 일수). unknown = null(미상, 무감점 + coverage 하락).
const BUCKET_DAYS: Record<LastUsedBucket, number | null> = {
  within1y: 180,
  '1to2y': 500,
  over2y: 900,
  unknown: null,
};

function bucketToDate(bucket: LastUsedBucket): Date | null {
  const days = BUCKET_DAYS[bucket];
  return days === null ? null : new Date(Date.now() - days * 86_400_000);
}

function riskOf(
  breached: boolean,
  unusedMonths: number,
  category: AccountDTO['category'],
): AccountDTO['risk'] {
  if (breached || unusedMonths >= 24) return 'high';
  if (unusedMonths >= 12 || category === 'overseas') return 'medium';
  return 'low';
}

function daysSince(d: Date | null): number {
  if (!d) return 3650;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: AccountUpdateRequest;
  try {
    body = (await request.json()) as AccountUpdateRequest;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  // 화이트리스트 검증 — 자가신고 4신호만. 타입 위반은 거부(불리언·enum 버킷).
  const data: {
    passwordReused?: boolean;
    twoFactorEnabled?: boolean;
    discovered?: boolean;
    lastUsedAt?: Date | null;
  } = {};
  if (body.passwordReused !== undefined) {
    if (typeof body.passwordReused !== 'boolean') {
      return Response.json({ error: 'passwordReused must be boolean' }, { status: 400 });
    }
    data.passwordReused = body.passwordReused;
  }
  if (body.twoFactorEnabled !== undefined) {
    if (typeof body.twoFactorEnabled !== 'boolean') {
      return Response.json({ error: 'twoFactorEnabled must be boolean' }, { status: 400 });
    }
    data.twoFactorEnabled = body.twoFactorEnabled;
  }
  if (body.discovered !== undefined) {
    if (typeof body.discovered !== 'boolean') {
      return Response.json({ error: 'discovered must be boolean' }, { status: 400 });
    }
    data.discovered = body.discovered;
  }
  if (body.lastUsedBucket !== undefined) {
    if (!(body.lastUsedBucket in BUCKET_DAYS)) {
      return Response.json({ error: 'invalid lastUsedBucket' }, { status: 400 });
    }
    data.lastUsedAt = bucketToDate(body.lastUsedBucket);
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'no updatable fields' }, { status: 400 });
  }

  try {
    // 소유권 경계: updateMany(where userId)로 타인 계정 갱신 원천 차단(count 0이면 미소유).
    const res = await prisma.account.updateMany({ where: { id, userId }, data });
    if (res.count === 0) {
      return Response.json({ error: 'account not found' }, { status: 404 });
    }
    const r = await prisma.account.findFirst({ where: { id, userId } });
    if (!r) {
      return Response.json({ error: 'account not found' }, { status: 404 });
    }
    const lastUsedDays = daysSince(r.lastUsedAt);
    const dto: AccountDTO = {
      id: r.id,
      name: r.name,
      category: r.category,
      provider: r.provider,
      source: r.source,
      lastUsedDays,
      breached: r.breached,
      risk: riskOf(r.breached, Math.floor(lastUsedDays / 30), r.category),
      twoFactorEnabled: r.twoFactorEnabled,
      passwordReused: r.passwordReused,
      discovered: r.discovered,
    };
    const envelope: ApiEnvelope<AccountDTO> = { data: dto };
    return Response.json(envelope);
  } catch (e) {
    // DB 미연결/시드 폴백 id(a01 등) → 실계정 아님. 정직하게 404(데모 시드는 읽기 전용).
    console.warn('[api/accounts PATCH] update failed:', (e as Error).message);
    return Response.json({ error: 'update unavailable' }, { status: 404 });
  }
}
