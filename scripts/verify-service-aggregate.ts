// 집계 게이트 검증 — 가려야 할 것이 실제로 가려지는지 실측한다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/verify-service-aggregate.ts
//
// 왜 실측인가: k-익명성은 "HAVING COUNT >= 5"라고 적어 두면 지켜지는 것처럼 보인다.
// 그런데 무엇을 세는지가 틀리면 조건은 통과하고 익명성만 사라진다. 한 사람이 같은 서비스에
// 계정 다섯 개를 가진 경우가 그렇다 — 스키마가 (userId, serviceId) 유니크를 일부러
// 걸지 않았으므로(개인용·업무용) 이 경로는 가정이 아니라 실제로 열려 있다.
// 그래서 사람을 여러 명 만들어 놓고 세어 본다.
//
// 안전: 이 스크립트가 만드는 사용자·서비스만 지운다. 실제 데이터는 읽기만 한다.
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  serviceHoldings,
  aggregateSummary,
  serviceHolderCount,
  MIN_HOLDERS,
} from '../lib/service-aggregate';

const prisma = new PrismaClient();

const FIXTURE_PREFIX = 'verify-agg-';
const stamp = Date.now();

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

type Fixture = { userIds: string[]; serviceIds: Record<string, string> };

async function makeUser(n: number): Promise<string> {
  const id = `${FIXTURE_PREFIX}${stamp}-${n}`;
  await prisma.user.create({ data: { id, email: `${id}@example.invalid`, name: `집계검증${n}` } });
  return id;
}

async function makeService(key: string): Promise<string> {
  const s = await prisma.service.create({
    data: { slug: `${FIXTURE_PREFIX}${stamp}-${key}`, displayName: `집계검증 ${key}` },
  });
  return s.id;
}

async function addAccount(
  userId: string,
  serviceId: string,
  source: 'user_input' | 'seed',
): Promise<void> {
  await prisma.account.create({
    data: {
      userId,
      serviceId,
      name: `집계검증-${serviceId.slice(0, 6)}`,
      provider: 'manual',
      category: 'unknown',
      source,
    },
  });
}

/**
 * 네 가지 상황을 실제 행으로 만든다.
 *   atK        — 서로 다른 사용자 정확히 k명   → 나와야 한다
 *   belowK     — 서로 다른 사용자 k-1명        → 가려져야 한다
 *   oneUserManyAccounts — 사용자 1명이 계정 k개 → 가려져야 한다(핵심)
 *   seedOnly   — 시드 사용자 k명               → 가려져야 한다
 */
async function build(): Promise<Fixture> {
  const userIds: string[] = [];
  for (let i = 0; i < MIN_HOLDERS + 1; i += 1) userIds.push(await makeUser(i));

  const serviceIds = {
    atK: await makeService('atK'),
    belowK: await makeService('belowK'),
    oneUserManyAccounts: await makeService('oneUser'),
    seedOnly: await makeService('seedOnly'),
  };

  for (let i = 0; i < MIN_HOLDERS; i += 1) await addAccount(userIds[i], serviceIds.atK, 'user_input');
  for (let i = 0; i < MIN_HOLDERS - 1; i += 1)
    await addAccount(userIds[i], serviceIds.belowK, 'user_input');
  // 한 사람이 같은 서비스에 계정을 k개. 계정 수로 세면 통과한다.
  for (let i = 0; i < MIN_HOLDERS; i += 1)
    await addAccount(userIds[0], serviceIds.oneUserManyAccounts, 'user_input');
  for (let i = 0; i < MIN_HOLDERS; i += 1) await addAccount(userIds[i], serviceIds.seedOnly, 'seed');

  return { userIds, serviceIds };
}

async function cleanup(f: Fixture): Promise<void> {
  for (const id of f.userIds) {
    if (!id.startsWith(FIXTURE_PREFIX)) throw new Error('안전장치: 시험용이 아닌 사용자');
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of Object.values(f.serviceIds)) {
    await prisma.service.delete({ where: { id } }).catch(() => {});
  }
}

async function main() {
  // ── 상수가 조용히 낮아지지 않았는가 ──
  check(MIN_HOLDERS >= 5, `1 k 하한이 5 이상이다 (현재 ${MIN_HOLDERS})`);

  // ── 방침이 말한 숫자와 코드가 같은가 ──
  //   개인정보 처리방침 5절은 "이용자가 5명 미만인 서비스는 집계에서 제외합니다"라고
  //   이용자에게 약속한다. 코드에서 k를 내리면 그 문장이 그날부터 거짓이 되는데, 방침은
  //   조용히 그대로 남는다. 둘을 여기서 묶어 둔다 — 한쪽만 바꾸면 검증이 깨진다.
  const policy = readFileSync('app/(legal)/privacy/page.tsx', 'utf8');
  const stated = policy.match(/이용자가\s*(\d+)\s*명\s*미만인\s*서비스는\s*집계에서\s*제외/);
  check(stated !== null, '2 방침에 집계 제외 기준이 적혀 있다');
  check(
    stated !== null && Number(stated[1]) === MIN_HOLDERS,
    `3 방침의 기준(${stated?.[1] ?? '없음'}명)과 코드의 k(${MIN_HOLDERS}명)가 같다`,
  );

  // ── 손대기 전 실데이터 상태 ──
  const before = await aggregateSummary();
  console.log(`실데이터: 대상 ${before.servicesConsidered} · 공개 ${before.servicesPublishable} · 가림 ${before.servicesSuppressed} · 기여자 ${before.contributingUsers}`);
  check(
    before.servicesPublishable + before.servicesSuppressed === before.servicesConsidered,
    '4 공개 + 가림이 대상 총수와 같다',
  );

  const fixture = await build();
  try {
    const rows = await serviceHoldings(200);
    const byId = new Map(rows.map((r) => [r.serviceId, r]));
    const s = fixture.serviceIds;

    check(byId.has(s.atK), `5 보유자 ${MIN_HOLDERS}명 서비스는 집계에 나온다`);
    check(byId.get(s.atK)?.holders === MIN_HOLDERS, '6 보유자 수가 실제와 같다');
    check(!byId.has(s.belowK), `7 보유자 ${MIN_HOLDERS - 1}명 서비스는 가려진다`);
    check(
      !byId.has(s.oneUserManyAccounts),
      `8 한 사람이 계정 ${MIN_HOLDERS}개를 가져도 가려진다(계정이 아니라 사람을 센다)`,
    );
    check(!byId.has(s.seedOnly), '9 시드로만 채워진 서비스는 집계에 들어오지 않는다');

    // ── 반환값에 개인이 실려 나가지 않는가 ──
    const serialized = JSON.stringify(rows);
    const leaked = fixture.userIds.filter((id) => serialized.includes(id));
    check(leaked.length === 0, '10 집계 결과에 사용자 식별자가 없다');
    const shape = Object.keys(byId.get(s.atK) ?? {}).sort().join(',');
    check(
      shape === 'category,holders,label,serviceId,verified',
      `11 반환 항목이 집계값뿐이다 (실제 ${shape})`,
    );

    // ── 단건 조회 ──
    check((await serviceHolderCount(s.atK)) === MIN_HOLDERS, '12 단건 조회가 보유자 수를 준다');
    check(
      (await serviceHolderCount(s.belowK)) === null,
      '13 k 미만 단건 조회는 null — 0이 아니다("없다"와 "말하지 않는다"는 다르다)',
    );
    check((await serviceHolderCount(s.seedOnly)) === null, '14 시드만 있는 서비스도 null');

    // ── 요약이 가림을 셈에 넣는가 ──
    const after = await aggregateSummary();
    check(
      after.servicesPublishable === before.servicesPublishable + 1,
      '15 요약의 공개 수가 정확히 1 늘었다(atK만 통과)',
    );
    // 늘어나는 가림은 belowK와 oneUserManyAccounts 둘뿐이다. seedOnly는 "가려진" 것이
    // 아니라 **집계 우주에 들어오지도 않는다** — 시드 제외는 게이트보다 앞단이다.
    check(
      after.servicesSuppressed === before.servicesSuppressed + 2,
      `16 요약이 가려진 서비스를 센다 (기대 +2, 실제 +${after.servicesSuppressed - before.servicesSuppressed})`,
    );
    check(
      after.servicesConsidered === before.servicesConsidered + 3,
      `17 시드만 있는 서비스는 대상 총수에도 들어오지 않는다 (기대 +3, 실제 +${after.servicesConsidered - before.servicesConsidered})`,
    );
    check(after.minHolders === MIN_HOLDERS, '18 요약이 적용된 k를 함께 알린다');
  } finally {
    await cleanup(fixture);
  }

  const restored = await aggregateSummary();
  check(
    restored.servicesConsidered === before.servicesConsidered,
    '19 검증이 실데이터를 남기지 않았다',
  );

  console.log(`verify-service-aggregate: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
