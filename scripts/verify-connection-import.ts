// 런타임 실측 — 소셜 연결목록 가져오기의 DB 반영 규칙. 실제 DB 대상.
// 실행: pnpm exec tsx scripts/verify-connection-import.ts
//
// 검증 항목
//   (a) 신규는 social_link 출처 + 가져온 화면의 provider로 저장(추측 아님)
//   (b) 카탈로그 밖 서비스도 저장되고 분류는 unknown (임의로 domestic/overseas를 찍지 않음)
//   (c) 활동일은 null — 연결 목록에 없는 정보를 지어내지 않음
//   (d) 기존에 가입 방식 미확인(manual)이던 계정은 provider가 확정으로 승격
//   (e) 사용자가 명시한 provider는 덮어쓰지 않음
//   (f) 재실행 멱등 — 같은 목록을 다시 가져와도 중복 계정이 생기지 않음
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유).
import { prisma } from '../lib/prisma';
import { categoryOf } from '../lib/connection-import';

const TEST_USER_ID = 'verify-conn-import-tmp';
const PROVIDER = 'google' as const;

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

// route.ts의 저장 규칙과 동일. 라우트는 세션이 필요해 여기서는 규칙만 재현한다.
async function importNames(userId: string, names: string[]) {
  const existing = await prisma.account.findMany({
    where: { userId },
    select: { id: true, name: true, provider: true },
  });
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const byName = new Map(existing.map((a) => [key(a.name), a]));

  const toCreate: string[] = [];
  const toUpgrade: string[] = [];
  for (const name of names) {
    const row = byName.get(key(name));
    if (!row) toCreate.push(name);
    else if (row.provider === 'manual') toUpgrade.push(row.id);
  }

  if (toCreate.length > 0) {
    await prisma.account.createMany({
      data: toCreate.map((name) => ({
        userId,
        name,
        provider: PROVIDER,
        category: categoryOf(name),
        source: 'social_link' as const,
        discovered: true,
        lastUsedAt: null,
      })),
    });
  }
  if (toUpgrade.length > 0) {
    await prisma.account.updateMany({ where: { id: { in: toUpgrade } }, data: { provider: PROVIDER } });
  }
  return { createdCount: toCreate.length, upgradedCount: toUpgrade.length };
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function main() {
  await cleanup();
  await prisma.user.create({
    data: { id: TEST_USER_ID, email: `${TEST_USER_ID}@example.invalid`, name: 'verify' },
  });

  // 기존 계정 2건: 하나는 가입 방식 미확인(manual), 하나는 사용자가 명시한 값(kakao)
  await prisma.account.createMany({
    data: [
      {
        userId: TEST_USER_ID,
        name: 'Airbnb',
        provider: 'manual', // 메일 스캔이 넣은 상태 — 승격 대상
        category: 'overseas',
        source: 'mail_scan',
      },
      {
        userId: TEST_USER_ID,
        name: '멜론',
        provider: 'kakao', // 사용자가 명시 — 보호 대상
        category: 'domestic',
        source: 'user_input',
      },
    ],
  });

  const r1 = await importNames(TEST_USER_ID, ['Docker', 'Netflix', 'Airbnb', '멜론']);
  check('a1 신규 생성 수', r1.createdCount === 2, `${r1.createdCount}건 (기대 2 — Docker·Netflix)`);
  check('d1 승격 수', r1.upgradedCount === 1, `${r1.upgradedCount}건 (기대 1 — Airbnb만)`);

  const docker = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, name: 'Docker' },
    select: { source: true, provider: true, category: true, lastUsedAt: true, discovered: true },
  });
  check(
    'a2 출처·가입방식 사실 기록',
    docker?.source === 'social_link' && docker?.provider === 'google',
    `source=${docker?.source}, provider=${docker?.provider}`,
  );
  check(
    'b  카탈로그 밖은 unknown 분류',
    docker?.category === 'unknown',
    `category=${docker?.category} (Docker는 카탈로그에 없음)`,
  );
  check('c  활동일 미상 유지', docker?.lastUsedAt === null, `lastUsedAt=${docker?.lastUsedAt}`);
  check('a3 몰랐던 계정 표시', docker?.discovered === true, `discovered=${docker?.discovered}`);

  const netflix = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, name: 'Netflix' },
    select: { category: true },
  });
  check(
    'b2 카탈로그 매칭은 분류 채움',
    netflix?.category === 'overseas',
    `category=${netflix?.category}`,
  );

  const airbnb = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, name: 'Airbnb' },
    select: { provider: true, source: true },
  });
  check(
    'd2 미확인 계정 승격',
    airbnb?.provider === 'google',
    `provider=${airbnb?.provider} (manual → google)`,
  );
  check(
    'd3 출처는 원래 값 보존',
    airbnb?.source === 'mail_scan',
    `source=${airbnb?.source} (발견 경로 이력을 덮지 않는다)`,
  );

  const melon = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, name: '멜론' },
    select: { provider: true },
  });
  check('e  사용자 명시값 보호', melon?.provider === 'kakao', `provider=${melon?.provider} (kakao 유지)`);

  // (f) 재실행 멱등
  const r2 = await importNames(TEST_USER_ID, ['Docker', 'Netflix', 'Airbnb', '멜론']);
  const total = await prisma.account.count({ where: { userId: TEST_USER_ID } });
  check('f1 재가져오기 신규 0', r2.createdCount === 0, `${r2.createdCount}건`);
  check('f2 계정 중복 없음', total === 4, `${total}건 (기대 4)`);

  console.log(failures === 0 ? '\n결과: 전 항목 PASS' : `\n결과: ${failures}건 FAIL`);
}

main()
  .catch((e) => {
    console.error('실행 실패:', (e as Error).message);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
