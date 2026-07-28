// GET /api/scan/gmail/client-id — 브라우저 토큰 요청에 필요한 OAuth 클라이언트 ID.
//
// 클라이언트 ID는 비밀이 아니다(모든 OAuth URL에 평문으로 실린다). 그럼에도 별도 라우트로 내려주는 이유는
// NEXT_PUBLIC_ 환경변수를 새로 만들면 로컬·Vercel 양쪽에 등록 작업이 늘기 때문이다. 기존 GOOGLE_CLIENT_ID
// 하나로 서버·클라이언트가 함께 쓴다. **클라이언트 시크릿은 절대 내려보내지 않는다.**
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ ok: false, error: '메일 스캔이 설정되지 않았습니다.' }, { status: 503 });
  }

  return Response.json({ ok: true, data: { clientId } });
}
