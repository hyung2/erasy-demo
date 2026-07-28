// POST /api/register — 자체 가입(이메일+비밀번호).
//
// 구글 로그인과 **같은 결과 상태**로 착지시키는 것이 목적이다: 가입 직후 본인 소유 데모 데이터 24계정이
// 프로비저닝돼 있고, 이후 진단·정리·결과 화면이 동일하게 동작한다(auth.ts signIn 콜백과 같은 경로).
// 세션 발급은 여기서 하지 않는다 — 클라이언트가 가입 성공 후 credentials signIn을 호출한다.
//
// 빌드타임 DB 접속 금지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { provisionDemoData } from '@/lib/provision-demo';
import { hashPassword, normalizeEmail, validatePassword } from '@/lib/password';

type RegisterBody = { email?: unknown; password?: unknown; name?: unknown };

function fail(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return fail('요청 형식이 올바르지 않습니다.', 400);
  }

  const rawEmail = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';

  const email = normalizeEmail(rawEmail);
  if (!email) return fail('이메일 주소를 다시 확인해 주세요.', 400);

  const pwError = validatePassword(password);
  if (pwError) return fail(pwError, 400);

  const name = rawName.slice(0, 50) || email.split('@')[0];

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    if (existing) {
      // 이미 쓰는 이메일. 소셜로 만든 계정인지까지는 알려주지 않는다(계정 열거 방지).
      return fail('이미 가입된 이메일입니다. 로그인해 주세요.', 409);
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true },
    });

    // 구글 첫 로그인과 동일한 프로비저닝. 실패해도 가입 자체는 성공으로 둔다(로그인 후 재시도 경로 존재).
    try {
      const p = await provisionDemoData(prisma, user.id, { idPrefix: `u${user.id}` });
      if (p.provisioned) {
        console.info(`[register] demo data provisioned: user=${user.id}, accounts=${p.accounts}`);
      }
    } catch (e) {
      console.warn('[register] provision skipped:', (e as Error).message);
    }

    return Response.json({ ok: true, data: { email } }, { status: 201 });
  } catch (e) {
    // unique 위반이 경합으로 뚫린 경우도 같은 문구로 수렴시킨다.
    const msg = (e as Error).message;
    if (msg.includes('Unique constraint')) {
      return fail('이미 가입된 이메일입니다. 로그인해 주세요.', 409);
    }
    console.error('[register] failed:', msg);
    return fail('가입 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.', 500);
  }
}
