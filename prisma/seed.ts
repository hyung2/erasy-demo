// Prisma 시드 — 데모 사용자(seed-user-demo)에 24계정 인벤토리를 적재.
// 멱등: 고정 id(`seed-a01`…) upsert라 재실행해도 drift 없음. 실행: `pnpm db:seed`.
//
// 적재 본문은 lib/provision-demo.ts가 소유한다(실 로그인 사용자 프로비저닝과 동일 코드 경로).
// 이 스크립트는 시드 유저 보장 + force 재적재만 담당한다.
// 자격증명 미저장 원칙 준수 — 비번/해시 없음. 신호 정본: 03-step02-mvp/score-spec-v2-multidim.md
import { PrismaClient } from '@prisma/client';
import { DEMO_USER_ID } from '../lib/dummy-data';
import { provisionDemoData } from '../lib/provision-demo';

const prisma = new PrismaClient();

const DEMO_USER_EMAIL = 'demo@erasy.app';
const DEMO_USER_NAME = '김민준';
const SEED_ID_PREFIX = 'seed'; // 기존 seed-a01·seed-b1·seed-al-01·seed-ss-01 id 보존

async function main() {
  // 데모 사용자(멱등). 실 로그인 사용자와 구분되는 시드 계정.
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: { email: DEMO_USER_EMAIL, name: DEMO_USER_NAME },
    create: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: DEMO_USER_NAME },
  });

  // force: 상대 시각(lastUsedAt·접속기록·스냅샷)을 실행 시점 기준으로 갱신하기 위해 항상 재적재.
  const result = await provisionDemoData(prisma, DEMO_USER_ID, {
    idPrefix: SEED_ID_PREFIX,
    force: true,
  });

  console.log(`seed done: user=${DEMO_USER_ID}, accounts=${result.accounts}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
