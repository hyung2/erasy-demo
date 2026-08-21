// 지정한 사용자의 유출 대조를 서버 밖에서 한 번 돌린다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/run-breach-scan.ts <이메일>
//
// 화면에서 버튼을 누르는 것과 같은 일을 한다(같은 lib 함수를 부른다). 세션·쿠키가
// 필요 없어 로그인 없이 실측할 수 있고, 라우트를 거치지 않으므로 이 스크립트가 도는 것은
// 곧 도메인 로직 자체가 도는 것이다.
//
// 쓰기 작업이다. DB에 Breach가 쌓이고 breachCheckedAt이 남는다 — 실행 전 백업을 확인할 것
// (scripts/backup-db.ts).
import { PrismaClient } from '@prisma/client';
import { syncUserBreaches } from '../lib/breach-sync';
import { isBreachLookupConfigured } from '../lib/hibp-breaches';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    throw new Error('이메일을 인자로 주세요: run-breach-scan.ts <이메일>');
  }
  if (!isBreachLookupConfigured()) {
    throw new Error('HIBP_API_KEY가 설정되지 않았습니다(--env-file=.env 확인).');
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, breachCheckedAt: true },
  });
  if (!user) throw new Error(`사용자를 찾을 수 없습니다: ${email}`);

  console.log(`대상: ${user.email} (이전 대조: ${user.breachCheckedAt?.toISOString() ?? '없음'})`);

  const result = await syncUserBreaches(user.id, user.email);
  console.log(
    JSON.stringify(
      {
        found: result.found,
        created: result.created,
        linkedToAccount: result.linkedToAccount,
        services: result.services,
      },
      null,
      1,
    ),
  );
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
