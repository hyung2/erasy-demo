// 심사용 계정을 만든다 — 제출 문서에 적어 심사위원이 바로 로그인할 수 있게.
//
// 실행: pnpm exec tsx --env-file=.env scripts/make-judge-account.ts <이메일> <비밀번호>
//
// **실계정 데이터를 쓰지 않는다.** 심사용 계정에 실제 인벤토리를 복제하면 그 사람이 어디에
// 가입했는지가 제출물에 딸려 나간다. 개인정보 보호를 파는 제품이 할 일이 아니다.
// 데모 24계정은 일반에 알려진 서비스명뿐이고 화면 밀도도 심사에 알맞다.
//
// 이 계정으로 들어가면 계정 스캔 화면에 "아직 실제로 찾은 계정이 없어 예시로 보여드립니다"가
// 뜬다. 가리지 않는다 — 출처를 밝히는 것이 이 제품이 파는 것이고, 그 배너 자체가 근거다.
//
// 비밀번호는 제출 문서에 공개될 값이므로 비밀이 아니다. 심사가 끝나면 지운다.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';
import { provisionDemoData } from '../lib/provision-demo';

export {};

const prisma = new PrismaClient();
const args = process.argv.slice(2);
/**
 * --empty 는 데모 데이터를 넣지 않는다. 웹스토어 심사자용이다.
 *
 * 심사자가 확인해야 하는 것은 **확장이 연결목록을 가져오는 동작**이고, 그 버튼은 온보딩에
 * 있다. 그런데 계정을 이미 가진 사용자는 로그인 시 대시보드로 바로 간다(2026-08-26).
 * 데모 데이터를 넣어 주면 심사자가 온보딩을 못 만나고 "기능 확인 불가"가 된다.
 * 빈 계정이라야 로그인 직후 온보딩에 떨어진다.
 */
const EMPTY = args.includes('--empty');
const [email, password] = args.filter((a) => !a.startsWith('--'));

async function main(): Promise<void> {
  if (!email || !password) {
    console.error('사용법: make-judge-account.ts <이메일> <비밀번호>');
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`이미 있는 계정이다 — ${email}. 지우고 다시 만들려면 먼저 삭제하십시오.`);
    return;
  }

  const u = await prisma.user.create({
    data: { email, name: '이레이지 심사용', passwordHash: await hashPassword(password) },
  });
  const r = EMPTY
    ? { accounts: 0 }
    : await provisionDemoData(prisma, u.id, { idPrefix: `judge-${u.id}-` });

  const [accounts, breaches, checked] = await Promise.all([
    prisma.account.count({ where: { userId: u.id } }),
    prisma.breach.count({ where: { userId: u.id } }),
    prisma.user.findUnique({ where: { id: u.id }, select: { breachCheckedAt: true } }),
  ]);

  console.log(`계정 생성 — ${email}${EMPTY ? ' (빈 계정 — 로그인 시 온보딩으로)' : ''}`);
  console.log(`  적재 ${r.accounts}건 · 인벤토리 ${accounts}건 · 유출 ${breaches}건`);
  // 유출이 0건이면 대조 시각이 없는 것이 정상이다. 유출을 심어 두고 시각만 비어 있을 때가
  // 결함이다(2026-08-25에 고친 그 상태). 둘을 같은 말로 적으면 정상을 결함으로 읽게 된다.
  const stamp = checked?.breachCheckedAt?.toISOString();
  console.log(
    `  대조 시각 ${stamp ?? (breaches > 0 ? '없음 — 유출이 있는데 비어 있다(결함)' : '없음(유출 0건이라 정상)')}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
