// 웹스토어 스크린샷용 데모 계정을 만든다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/make-store-shot-user.ts
//
// **실계정으로 찍지 않는다.** 스토어 스크린샷은 공개되고, 실제 인벤토리에는 그 사람이 어디에
// 가입했는지가 그대로 들어 있다. 개인정보 보호를 파는 제품이 자기 사용자의 가입 목록을
// 홍보 이미지로 내보내면 그것으로 끝이다.
//
// 시드 24계정은 일반에 알려진 서비스명뿐이고 화면 밀도도 스크린샷에 알맞다.
// 표시 이름은 화면 사이드바에 그대로 나오므로 공개해도 되는 값으로 둔다.
//
// 찍고 나면 지운다 — scripts에 정리용 스크립트를 따로 두지 않았으므로
// `email LIKE '%@example.invalid'`로 지우면 된다(시험 계정은 전부 이 도메인을 쓴다).
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';
import { provisionDemoData } from '../lib/provision-demo';

const prisma = new PrismaClient();
const email = `store-shot-${Date.now()}@example.invalid`;
const password = 'store-shot-pw-2026';

(async () => {
  const u = await prisma.user.create({
    data: { email, name: '이레이지', passwordHash: await hashPassword(password) },
  });
  const r = await provisionDemoData(prisma, u.id, { idPrefix: `sst-${u.id}-` });

  console.log(email);
  console.log(password);
  console.log(`계정 ${r.accounts}건 적재`);
  await prisma.$disconnect();
})();
