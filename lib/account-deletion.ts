// 회원 탈퇴 — 보관 중인 개인정보를 지운다.
//
// 왜 필요한가: 개인정보 처리방침 5항이 "화면에서 직접 탈퇴하는 기능은 제공하지 않습니다"라고
// **사실대로** 적혀 있었다. 방침이 정직했던 것과 별개로, 남의 계정 목록을 통째로 들고 있는
// 제품이 나가는 문을 안 만들어 둔 것은 그 자체로 결함이다.
//
// 라우트가 아니라 lib에 두는 이유: 이 함수가 정말 전부 지우는지를 가드가 직접 재야 한다.
// 라우트에 두면 검증이 자기 서버에 HTTP를 걸어야 하고, 쿠키가 안 실려 401로 끝나면서 정작
// 중요한 규칙이 검증에서 빠진다(feedback_internal_auth_api_fetch_401).
import { prisma } from '@/lib/prisma';

/** 탈퇴하면 함께 사라지는 것들. 지우기 **전에** 사용자에게 보여 주기 위한 값. */
export type DeletionSummary = {
  email: string;
  accounts: number;
  breaches: number;
  cleanupRequests: number;
  alerts: number;
  scoreSnapshots: number;
  accessLogs: number;
};

/**
 * 무엇이 지워지는지 센다.
 *
 * 화면에 "정말 삭제할까요?"만 띄우고 마는 대신 실제 보유량을 보여 준다. 자기 데이터가
 * 얼마나 쌓였는지 모르는 채 누르는 비가역 버튼은 동의라고 부르기 어렵다.
 */
export async function summarizeUserData(userId: string): Promise<DeletionSummary | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) return null;

  const [accounts, breaches, cleanupRequests, alerts, scoreSnapshots, accessLogs] =
    await Promise.all([
      prisma.account.count({ where: { userId } }),
      prisma.breach.count({ where: { userId } }),
      prisma.cleanupRequest.count({ where: { userId } }),
      prisma.alert.count({ where: { userId } }),
      prisma.scoreSnapshot.count({ where: { userId } }),
      prisma.accessLog.count({ where: { account: { userId } } }),
    ]);

  return { email: user.email, accounts, breaches, cleanupRequests, alerts, scoreSnapshots, accessLogs };
}

/** 실제로 지운 행 수. 요청과 결과가 같은지 대조하기 위해 돌려준다. */
export type DeletionResult = { deleted: DeletionSummary };

/**
 * 사용자와 그에 딸린 모든 개인정보를 지운다.
 *
 * 삭제는 User 한 행에만 걸고 나머지는 FK의 ON DELETE CASCADE에 맡긴다. 자식 테이블을
 * 손으로 하나씩 지우는 코드를 쓰지 않는 이유는, 그렇게 쓰면 **나중에 테이블이 하나 늘었을 때
 * 조용히 빠지기 때문이다.** 그때 남는 잔여 데이터는 아무도 모르고, 방침만 거짓말이 된다.
 * 대신 cascade가 실제로 도는지는 가드가 매번 실측한다(scripts/verify-account-deletion.ts).
 *
 * Service(서비스 카탈로그)는 지우지 않는다. 그 행에는 사람이 들어 있지 않다 — 서비스명과
 * 도메인뿐이고, 여러 사용자가 함께 참조한다. Account.serviceId는 SetNull이라 연결만 끊긴다.
 *
 * 되돌릴 수 없다. 확인 절차는 호출부(라우트)가 책임진다.
 */
export async function deleteUserAccount(userId: string): Promise<DeletionResult | null> {
  const summary = await summarizeUserData(userId);
  if (!summary) return null;

  await prisma.user.delete({ where: { id: userId } });

  return { deleted: summary };
}

/**
 * 확인 문구가 맞는가.
 *
 * 자기 이메일을 그대로 적게 한다. 체크박스 한 번보다 번거롭지만, 비가역 작업에서 번거로움은
 * 비용이 아니라 안전장치다. 대소문자·앞뒤 공백은 봐준다 — 막고 싶은 것은 오타가 아니라
 * **의도 없이 누르는 것**이다.
 */
export function confirmationMatches(input: string, email: string): boolean {
  return input.trim().toLowerCase() === email.trim().toLowerCase();
}
