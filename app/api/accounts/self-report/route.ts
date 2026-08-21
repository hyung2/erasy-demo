// POST /api/accounts/self-report — 여러 계정의 자가신고 신호를 한 번에 저장한다.
//
// 왜 일괄인가
//   위생축(가중치 0.30)은 비밀번호 재사용과 2단계 인증으로 재는데, 그건 **사용자만 아는
//   사실**이다. 우리는 비밀번호를 저장하지 않으므로 서버가 알아낼 방법이 없다.
//   그런데 신고 경로가 "계정 하나 열고 → 모달에서 체크 → 닫고 → 다음 계정"뿐이라
//   264개를 가진 사용자에게는 사실상 없는 길이었다. 실측에서 coverage가 0이었다.
//   한 화면에서 몇 개를 한꺼번에 넘기는 경로가 있어야 축이 살아난다.
//
// 신호 정책: 자가신고는 **"예"라고 답한 것만** 관측으로 친다(2026-08-20 W7 확정).
//   전부 false인 신고는 "모른다"와 구별되지 않으므로 분모에 넣지 않는다.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';

type ReportItem = {
  id: string;
  passwordReused: boolean;
  twoFactorEnabled: boolean;
};

function parseItems(raw: unknown): ReportItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null;
  const out: ReportItem[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return null;
    const { id, passwordReused, twoFactorEnabled } = r as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof passwordReused !== 'boolean' || typeof twoFactorEnabled !== 'boolean') return null;
    out.push({ id, passwordReused, twoFactorEnabled });
  }
  return out;
}

export async function POST(req: Request) {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ ok: false, error: sessionUser.message }, { status: sessionUser.status });
  }

  const body = (await req.json().catch(() => ({}))) as { items?: unknown };
  const items = parseItems(body.items);
  if (!items) {
    return Response.json({ ok: false, error: '입력 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    // 소유권 경계: updateMany + userId 조건으로 건별 갱신. 남의 계정 id가 섞여 들어오면
    // count 0으로 조용히 지나가고 DB에는 아무 일도 일어나지 않는다.
    const results = await prisma.$transaction(
      items.map((it) =>
        prisma.account.updateMany({
          where: { id: it.id, userId: sessionUser.userId },
          data: {
            passwordReused: it.passwordReused,
            twoFactorEnabled: it.twoFactorEnabled,
          },
        }),
      ),
    );

    const updated = results.reduce((sum, r) => sum + r.count, 0);
    // "예"가 하나도 없는 신고는 관측으로 치지 않으므로 그 수를 따로 돌려준다.
    // 화면이 "몇 개가 실제로 점수에 반영됐는지"를 사실대로 말할 수 있어야 한다.
    const observed = items.filter((it) => it.passwordReused || it.twoFactorEnabled).length;

    return Response.json({ ok: true, data: { updated, observed } });
  } catch (e) {
    console.error('[accounts/self-report] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}
