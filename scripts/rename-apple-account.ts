// 일회성 데이터 정정 — 시드로 심긴 'Apple Music' 계정을 'Apple 계정'으로 개명(이슈 #4).
// 실행: pnpm exec tsx scripts/rename-apple-account.ts
//
// 왜 필요한가: apple.com에서 오는 메일은 Apple ID 보안 알림·App Store 영수증이 대부분이라
// 'Apple Music 가입'의 근거가 되지 못한다. 카탈로그·시드를 계정 단위로 정정했으므로,
// 이미 프로비저닝된 계정의 표기도 맞춰 화면에 옛 이름이 남지 않게 한다.
//
// 안전장치
//  - source가 'seed'인 행만 대상. 사용자가 직접 입력했거나 메일 스캔이 넣은 행은 건드리지 않는다.
//  - 같은 사용자에게 'Apple 계정'이 이미 있으면 중복이 되므로 개명하지 않고 보고만 한다.
//  - 삭제는 하지 않는다. 되돌리려면 이름만 원복하면 된다.
import { prisma } from '../lib/prisma';

const OLD_NAME = 'Apple Music';
const NEW_NAME = 'Apple 계정';

async function main() {
  const targets = await prisma.account.findMany({
    where: { name: OLD_NAME, source: 'seed' },
    select: { id: true, userId: true },
  });
  console.log(`대상(source=seed, name="${OLD_NAME}"): ${targets.length}건`);

  const conflicts = await prisma.account.findMany({
    where: { name: NEW_NAME, userId: { in: targets.map((t) => t.userId) } },
    select: { userId: true },
  });
  const blocked = new Set(conflicts.map((c) => c.userId));
  if (blocked.size > 0) {
    console.log(`건너뜀(이미 "${NEW_NAME}" 보유): ${blocked.size}명`);
  }

  const renamable = targets.filter((t) => !blocked.has(t.userId));
  if (renamable.length === 0) {
    console.log('개명할 행이 없습니다.');
    return;
  }

  const result = await prisma.account.updateMany({
    where: { id: { in: renamable.map((r) => r.id) } },
    data: { name: NEW_NAME },
  });
  console.log(`개명 완료: ${result.count}건`);

  const remaining = await prisma.account.count({ where: { name: OLD_NAME } });
  console.log(`잔존 "${OLD_NAME}": ${remaining}건 (0이면 정정 완료)`);
}

main()
  .catch((e) => {
    console.error('실행 실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
