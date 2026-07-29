// 런타임 실측 — Gmail 스캔 결과의 인벤토리 반영 회귀 가드. 실제 DB 대상.
// 실행: pnpm exec tsx scripts/verify-gmail-apply.ts
//
// 검증 항목
//   (a) 신규 발견 → mail_scan 출처 + discovered 표시로 생성
//   (b) 기존 계정 → 메일 추정치가 더 최신일 때만 활동일 갱신
//   (c) 더 오래된 추정치는 기존 값을 덮지 않음 (실측·자가신고 값 보호)
//   (d) 재스캔 멱등 — 같은 결과로 다시 돌려도 계정이 중복 생성되지 않음
//   (e) 개명 서비스(Apple 계정 ← Apple Music) — 옛 표기 계정을 중복 생성하지 않고 갱신
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유).
import { prisma } from '../lib/prisma';
import { diffAgainstInventory, type ScanHit } from '../lib/gmail-scan';

const TEST_USER_ID = 'verify-gmail-apply-tmp';
const DAY = 86_400_000;
const NOW = Date.now();

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

// route.ts의 applyToInventory와 동일 규칙. 라우트는 세션이 필요해 여기서는 규칙만 재현한다.
async function apply(userId: string, hits: ScanHit[]) {
  const existing = await prisma.account.findMany({
    where: { userId },
    select: { id: true, name: true, lastUsedAt: true },
  });
  const { discovered, updated, matchedNames } = diffAgainstInventory(
    hits,
    existing.map((a) => a.name),
  );
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const byName = new Map(existing.map((a) => [key(a.name), a]));

  let updatedCount = 0;
  for (const hit of updated) {
    // 개명 서비스는 인벤토리에 저장된 옛 이름으로 되짚는다.
    const row = byName.get(key(matchedNames.get(hit.service) ?? hit.service));
    if (!row) continue;
    const seenAt = new Date(hit.lastSeenAt);
    if (row.lastUsedAt && row.lastUsedAt >= seenAt) continue;
    await prisma.account.update({ where: { id: row.id }, data: { lastUsedAt: seenAt } });
    updatedCount += 1;
  }
  if (discovered.length > 0) {
    await prisma.account.createMany({
      data: discovered.map((hit) => ({
        userId,
        name: hit.service,
        provider: 'manual' as const,
        category: hit.category,
        source: 'mail_scan' as const,
        discovered: true,
        lastUsedAt: new Date(hit.lastSeenAt),
      })),
    });
  }
  return { discoveredCount: discovered.length, updatedCount };
}

function hit(service: string, daysAgo: number, category: ScanHit['category'] = 'domestic'): ScanHit {
  return {
    service,
    category,
    domain: 'example.com',
    lastSeenAt: NOW - daysAgo * DAY,
    lastSeenDays: daysAgo,
    messageCount: 1,
  };
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

  // 기존 계정 2건: 하나는 오래된 활동일, 하나는 최신 활동일
  await prisma.account.createMany({
    data: [
      {
        userId: TEST_USER_ID,
        name: '쿠팡',
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
        lastUsedAt: new Date(NOW - 600 * DAY), // 오래됨 → 갱신 대상
      },
      {
        userId: TEST_USER_ID,
        name: '토스',
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
        lastUsedAt: new Date(NOW - 2 * DAY), // 최신 → 보호 대상
      },
    ],
  });

  // (a)(b)(c) 1차 반영
  const hits = [
    hit('쿠팡', 10), // 기존보다 최신 → 갱신
    hit('토스', 300), // 기존보다 오래됨 → 무시돼야 함
    hit('Netflix', 30, 'overseas'), // 신규
  ];
  const r1 = await apply(TEST_USER_ID, hits);
  check('a1 신규 발견 수', r1.discoveredCount === 1, `${r1.discoveredCount}건 (기대 1)`);
  check('b1 갱신 수', r1.updatedCount === 1, `${r1.updatedCount}건 (기대 1 — 쿠팡만)`);

  const netflix = await prisma.account.findFirst({
    where: { userId: TEST_USER_ID, name: 'Netflix' },
    select: { source: true, discovered: true, provider: true, category: true },
  });
  check(
    'a2 출처·발견 표시',
    netflix?.source === 'mail_scan' && netflix?.discovered === true,
    `source=${netflix?.source}, discovered=${netflix?.discovered}`,
  );
  check(
    'a3 provider 추측 금지',
    netflix?.provider === 'manual',
    `provider=${netflix?.provider} (메일로는 가입 방식을 알 수 없음)`,
  );

  const coupang = await prisma.account.findFirst({ where: { userId: TEST_USER_ID, name: '쿠팡' } });
  const coupangDays = Math.round((NOW - (coupang?.lastUsedAt?.getTime() ?? 0)) / DAY);
  check('b2 오래된 값 갱신됨', coupangDays === 10, `${coupangDays}일 (기대 10)`);

  const toss = await prisma.account.findFirst({ where: { userId: TEST_USER_ID, name: '토스' } });
  const tossDays = Math.round((NOW - (toss?.lastUsedAt?.getTime() ?? 0)) / DAY);
  check('c  최신 값 보호(덮어쓰기 안 함)', tossDays === 2, `${tossDays}일 (기대 2 — 300 아님)`);

  // (d) 재스캔 멱등
  const r2 = await apply(TEST_USER_ID, hits);
  const total = await prisma.account.count({ where: { userId: TEST_USER_ID } });
  check('d1 재스캔 시 신규 0', r2.discoveredCount === 0, `${r2.discoveredCount}건`);
  check('d2 계정 중복 없음', total === 3, `${total}건 (기대 3)`);

  // (e) 개명 서비스 — 인벤토리에는 옛 표기(Apple Music)가 있고 스캔은 새 표기(Apple 계정)로 온다.
  await prisma.account.create({
    data: {
      userId: TEST_USER_ID,
      name: 'Apple Music',
      provider: 'manual',
      category: 'overseas',
      source: 'seed',
      lastUsedAt: new Date(NOW - 500 * DAY),
    },
  });
  const r3 = await apply(TEST_USER_ID, [hit('Apple 계정', 20, 'overseas')]);
  const appleRows = await prisma.account.count({
    where: { userId: TEST_USER_ID, name: { contains: 'Apple' } },
  });
  check('e1 옛 표기 계정은 신규 아님', r3.discoveredCount === 0, `${r3.discoveredCount}건 (기대 0)`);
  check('e2 옛 표기 계정 활동일 갱신', r3.updatedCount === 1, `${r3.updatedCount}건 (기대 1)`);
  check('e3 Apple 계정 중복 없음', appleRows === 1, `${appleRows}건 (기대 1)`);

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
