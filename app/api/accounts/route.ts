// GET /api/accounts — 계정 인벤토리. 실+시드 하이브리드(T2.3).
//  로그인 세션(email)로 스코핑 → Prisma 실쿼리. DB 미연결/실계정 0건이면 시드 폴백.
//  source 필드로 출처 정직 표기(seed/user_input/oauth_linked). shape = AccountDTO 계약.
// 빌드타임 DB 접속 금지 → force-dynamic + 런타임에만 Prisma 호출.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import type { ApiEnvelope, AccountDTO, AccountCreateRequest } from '@/lib/api-types';
import { accounts as seed, deriveRisk, type LinkMethod } from '@/lib/dummy-data';

// dummy linkMethod → DB provider enum 매핑(스키마 정본)
function toProvider(m: LinkMethod): AccountDTO['provider'] {
  if (m === 'email-password') return 'manual';
  return m.replace('-oauth', '') as AccountDTO['provider'];
}

// 위험도 산출(dummy deriveRisk와 동일 규칙 — DB row/seed 공용)
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
  if (!d) return 3650; // 미상 → 장기 미사용으로 취급(휴면)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

// 시드 폴백: dummy 24계정을 AccountDTO로. 전부 source:'seed'(정직 표기 — 실연동 아님).
function seedDTO(): AccountDTO[] {
  return seed.map((a) => ({
    id: a.id,
    name: a.service,
    category: a.category,
    provider: toProvider(a.linkMethod),
    source: 'seed',
    lastUsedDays: a.lastUsedDays,
    breached: a.breached,
    risk: deriveRisk(a),
    twoFactorEnabled: a.twoFactorEnabled ?? false,
    passwordReused: a.passwordReused ?? false,
    discovered: a.discovered ?? false,
  }));
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // userId(google sub) 스코핑. User 생성은 signIn 콜백(auth.ts)이 담당.
    const rows = await prisma.account.findMany({
      where: { userId },
      orderBy: [{ breached: 'desc' }, { lastUsedAt: 'asc' }],
    });

    // 실계정 0건 → 시드 폴백(발견 목록 데모). 실데이터 들어오면 자동 전환.
    if (rows.length === 0) {
      const body: ApiEnvelope<AccountDTO[]> = { data: seedDTO() };
      return Response.json(body);
    }

    const data: AccountDTO[] = rows.map((r) => {
      const lastUsedDays = daysSince(r.lastUsedAt);
      return {
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
    });
    const body: ApiEnvelope<AccountDTO[]> = { data };
    return Response.json(body);
  } catch (e) {
    // DB 미연결(시크릿·Neon 프로비저닝 전) → 시드 폴백. 데모 무중단.
    console.warn('[api/accounts] DB unavailable, seed fallback:', (e as Error).message);
    const body: ApiEnvelope<AccountDTO[]> = { data: seedDTO() };
    return Response.json(body);
  }
}

// POST /api/accounts — 몰랐던 계정 직접 추가(T5.4 F2). 서비스명만 입력, 나머지 파생.
//  source=user_input·discovered=true·provider=manual·lastUsedAt=null(미상). 점수 재계산은 GET /api/score.
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: AccountCreateRequest;
  try {
    body = (await request.json()) as AccountCreateRequest;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 60) {
    return Response.json({ error: 'name required (1~60 chars)' }, { status: 400 });
  }

  try {
    const r = await prisma.account.create({
      data: {
        userId,
        name,
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
        discovered: true, // 몰랐던 계정 = 자가발견
        lastUsedAt: null, // 미상(coverage 하락, 무감점)
      },
    });
    const dto: AccountDTO = {
      id: r.id,
      name: r.name,
      category: r.category,
      provider: r.provider,
      source: r.source,
      lastUsedDays: daysSince(r.lastUsedAt),
      breached: r.breached,
      risk: riskOf(r.breached, 120, r.category), // lastUsedAt null → 장기 미사용 취급(daysSince 3650)
      twoFactorEnabled: r.twoFactorEnabled,
      passwordReused: r.passwordReused,
      discovered: r.discovered,
    };
    const envelope: ApiEnvelope<AccountDTO> = { data: dto };
    return Response.json(envelope, { status: 201 });
  } catch (e) {
    console.warn('[api/accounts POST] create failed:', (e as Error).message);
    return Response.json({ error: 'create unavailable' }, { status: 503 });
  }
}
