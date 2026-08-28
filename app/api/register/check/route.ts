// POST /api/register/check — 이 이메일이 가입돼 있는가.
//
// 왜 있는가: 시작 화면이 로그인/가입 탭 선택을 없애고 이메일부터 받는다. 그 이메일이
// 누구인지에 따라 다음 화면이 "비밀번호 입력"(기존)과 "비밀번호 만들기"(신규)로 갈리는데,
// 그 판정을 사용자에게 시키지 않고 여기서 한다 — 자기가 가입했는지 기억하는 것은
// 사용자의 일이 아니다.
//
// 계정 열거에 대해: 이 응답은 register가 이미 말하는 것(409 "이미 가입된 이메일입니다")
// 이상을 새로 노출하지 않는다. 숨기려면 register의 중복 안내부터 없애야 하는데, 그러면
// 가입 실패 이유를 사용자가 알 수 없게 된다 — MVP에서는 안내가 이긴다.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/password';

export async function POST(req: Request) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!email) {
    return Response.json({ ok: false, error: '이메일 주소를 다시 확인해 주세요.' }, { status: 400 });
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      // passwordHash 유무까지 본다 — 구글로만 만든 계정이면 비밀번호가 없어서
      //   "비밀번호를 입력하세요"가 성립하지 않는다. 그 경우 구글 버튼으로 안내한다.
      select: { passwordHash: true },
    });
    return Response.json({
      ok: true,
      data: {
        exists: existing !== null,
        hasPassword: existing?.passwordHash != null,
      },
    });
  } catch (e) {
    console.error('[register/check] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '확인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}
