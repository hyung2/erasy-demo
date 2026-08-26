// GET /after-login — 로그인 직후 착지점을 정한다.
//
// 왜 필요한가: 로그인은 늘 `/scanning`으로 보냈다. 그래서 **이미 계정을 모아 둔 사용자도**
// 들어올 때마다 4단계 온보딩을 다시 지나야 했다. 매번 하는 일이 "건너뛰기를 네 번 누르는 것"이면
// 그건 온보딩이 아니라 통행세다.
//
// 재수집이 필요 없다는 뜻은 아니다. 대시보드와 계정 스캔에 **다시 찾기 입구가 이미 있다**.
// 재수집은 사용자가 원할 때 누르는 것이지 로그인할 때마다 강제되는 것이 아니다.
//
// 판단 기준은 "계정을 갖고 있는가" 하나다. 온보딩을 끝냈는지를 따로 기록해 두는 방법도 있지만,
// 그러면 상태가 둘(플래그와 실제 보유)로 갈리고 언젠가 어긋난다. 실제 보유가 곧 사실이다.
//
// 화면이 아니라 라우트 핸들러인 이유: 클라이언트에서 판단하면 온보딩이 한 번 그려졌다가
// 사라진다. 서버에서 정하면 사용자는 깜빡임을 보지 않는다.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  const session = await auth();
  const userId = session?.user?.id;

  // 세션이 없으면 로그인 화면으로. proxy가 이미 막지만, 라우트 스스로도 서 있어야 한다.
  if (!userId) return Response.redirect(new URL('/', origin));

  const accounts = await prisma.account.count({ where: { userId } });
  return Response.redirect(new URL(accounts > 0 ? '/dashboard' : '/scanning', origin));
}
