// /api/me — 내 회원 정보. GET은 보관 현황, DELETE는 탈퇴.
//
// 경로를 /api/account로 두지 않은 이유: 이 제품에서 "Account"는 **내가 가입해 둔 외부 서비스
// 계정**을 뜻하고 이미 /api/accounts가 그것이다. 회원 자신을 같은 단어로 부르면, 언젠가
// /api/account와 /api/accounts를 헷갈린 한 글자가 전량 삭제로 이어진다.
export const dynamic = 'force-dynamic';

import { resolveSessionUser } from '@/lib/session-user';
import {
  summarizeUserData,
  deleteUserAccount,
  confirmationMatches,
} from '@/lib/account-deletion';

/** GET — 탈퇴하면 무엇이 함께 지워지는지. 확인 화면이 사실대로 말하기 위한 값. */
export async function GET() {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ ok: false, error: sessionUser.message }, { status: sessionUser.status });
  }

  try {
    const summary = await summarizeUserData(sessionUser.userId);
    if (!summary) {
      return Response.json({ ok: false, error: '회원 정보를 찾을 수 없습니다.' }, { status: 404 });
    }
    return Response.json({ ok: true, data: summary });
  } catch (e) {
    console.error('[api/me GET] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '보관 현황을 불러오지 못했습니다.' },
      { status: 502 },
    );
  }
}

/**
 * DELETE — 탈퇴. 되돌릴 수 없다.
 *
 * 확인 문구를 서버에서 **다시** 대조한다. 화면에서 이미 검사하지만 그건 사용자 실수를
 * 막는 장치이고, 여기서 막는 것은 화면을 거치지 않고 들어오는 요청이다.
 *
 * 대조 기준은 요청이 보낸 이메일이 아니라 DB에 있는 이메일이다. 클라이언트가 보낸 값끼리
 * 맞춰 보면 확인 절차 전체가 아무것도 확인하지 않는 형식이 된다.
 */
export async function DELETE(req: Request) {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) {
    return Response.json({ ok: false, error: sessionUser.message }, { status: sessionUser.status });
  }

  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  const confirm = typeof body?.confirm === 'string' ? body.confirm : '';

  try {
    const summary = await summarizeUserData(sessionUser.userId);
    if (!summary) {
      return Response.json({ ok: false, error: '회원 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!confirmationMatches(confirm, summary.email)) {
      return Response.json(
        { ok: false, error: '확인 문구가 이메일 주소와 일치하지 않습니다.', reason: 'confirm_mismatch' },
        { status: 400 },
      );
    }

    const result = await deleteUserAccount(sessionUser.userId);
    if (!result) {
      // summarize와 delete 사이에 이미 사라진 경우. 목적은 달성됐으므로 성공으로 본다.
      return Response.json({ ok: true, data: { deleted: summary } });
    }

    console.warn(
      '[api/me DELETE] account deleted',
      JSON.stringify({ accounts: result.deleted.accounts, breaches: result.deleted.breaches }),
    );
    return Response.json({ ok: true, data: result });
  } catch (e) {
    console.error('[api/me DELETE] failed:', (e as Error).message);
    return Response.json(
      { ok: false, error: '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
}
