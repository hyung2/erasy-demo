// 집계 현황 조회 — 운영자용. 읽기 전용.
//
// 실행: pnpm exec tsx --env-file=.env scripts/inspect-aggregate.ts
//
// 화면이 아니라 CLI인 이유: 지금 이 집계는 사용자에게 보여 줄 것이 없다. 기여자가 k명에
// 이르기 전에는 어떤 서비스도 게이트를 통과하지 못하고, 통과 못 한 상태를 화면에 올리면
// "아직 데이터가 없습니다"라는 빈 카드가 하나 늘 뿐이다. 숫자가 쌓였는지는 여기서 본다.
import { PrismaClient } from '@prisma/client';
import { serviceHoldings, aggregateSummary, MIN_HOLDERS } from '../lib/service-aggregate';

const prisma = new PrismaClient();

async function main() {
  const s = await aggregateSummary();

  console.log('── 집계 현황 ──');
  console.log(`k 하한            ${s.minHolders}명`);
  console.log(`기여 사용자       ${s.contributingUsers}명 (시드 제외)`);
  console.log(`집계 대상 서비스  ${s.servicesConsidered}개`);
  console.log(`  공개 가능       ${s.servicesPublishable}개`);
  console.log(`  가림(k 미만)    ${s.servicesSuppressed}개`);

  if (s.contributingUsers < MIN_HOLDERS) {
    // 결과가 비는 이유가 둘이라 구분해서 말한다. 사람이 부족한 것과, 사람은 있는데 겹치는
    // 서비스가 없는 것은 다른 상태이고 다음에 할 일도 다르다.
    console.log(
      `\n기여자가 ${s.contributingUsers}명이라 어떤 서비스도 ${MIN_HOLDERS}명에 이를 수 없습니다.`,
    );
    console.log('게이트가 정상 작동한 결과입니다 — 값을 만들려고 k를 낮추지 마십시오.');
    return;
  }

  const rows = await serviceHoldings(30);
  if (rows.length === 0) {
    console.log(`\n사용자는 충분하나 ${MIN_HOLDERS}명 이상이 함께 쓰는 서비스가 아직 없습니다.`);
    return;
  }

  console.log('\n── 보유자 상위 ──');
  for (const r of rows) {
    console.log(`${String(r.holders).padStart(4)}명  ${r.label}${r.verified ? '' : ' (이름 미확인)'}`);
  }
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
