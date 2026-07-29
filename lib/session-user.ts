// 세션 사용자 확인 — 쓰기 라우트의 공통 진입 게이트.
//
// 왜 세션만으로 부족한가: 세션은 JWT라 서버 상태를 보지 않는다. DB에서 User 행이 사라져도
// (테스트 계정 정리·수동 삭제) 쿠키는 그대로 유효하고, 그 상태로 Account를 insert하면
// `Account_userId_fkey`에 걸려 500으로 끝난다. 읽기 경로는 시드 폴백이 있어 화면이 멀쩡해
// 보이므로, **화면은 정상인데 쓰기만 죽는** 상태가 조용히 유지된다 — 데모 중 가장 나쁜 실패 방식.
//
// 그래서 쓰기 전에 User 실재를 한 번 확인하고, 없으면 재로그인을 안내한다.
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

/** User 행이 실제로 있는지. 세션 유효성과 별개인 DB 사실 확인. */
export async function userExists(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return row !== null;
}

export type SessionUser =
  | { ok: true; userId: string }
  | { ok: false; status: 401; message: string };

/**
 * 로그인 세션 + User 실재를 함께 확인한다. 쓰기 라우트는 이걸 통과한 뒤에만 DB에 손댄다.
 * 두 실패를 다른 문구로 가르는 이유: "로그인이 필요합니다"와 "다시 로그인해 주세요"는
 * 사용자가 취할 행동이 다르다(로그인 / 로그아웃 후 재로그인).
 */
export async function resolveSessionUser(): Promise<SessionUser> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, status: 401, message: '로그인이 필요합니다.' };

  if (!(await userExists(userId))) {
    return {
      ok: false,
      status: 401,
      message: '세션 정보가 서버와 맞지 않습니다. 로그아웃 후 다시 로그인해 주세요.',
    };
  }
  return { ok: true, userId };
}
