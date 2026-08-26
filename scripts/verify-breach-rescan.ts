// 정기 자동 대조의 비용 게이트와 인증 — 격리 DB. 외부 API는 부르지 않는다.
//
// 실행: DATABASE_URL=<격리> pnpm exec tsx scripts/verify-breach-rescan.ts
//
// 왜 재는가: 이 경로는 **유료 API를 부른다.** 게이트가 느슨해지면 그대로 비용이고, 그
// 사실은 청구서가 오기 전까지 아무 화면에도 나타나지 않는다. 조용히 새는 종류라 검사가
// 없으면 알 방법이 없다.
//
// 무엇을 지키는가
//   (1) 대상 축소 — 계정 없는 사용자는 대조하지 않는다(대조할 대상이 없다)
//   (2) 간격 — 최근에 본 사용자는 다시 보지 않는다. 호출 횟수가 아니라 경과 시간이 비용을 정한다
//   (3) 회당 상한 — 한 번의 실행이 무한정 비싸지지 않는다
//   (4) 오래된 순 — 가장 오래 안 본 사람부터. 한 번도 안 본 사람이 맨 앞
//   (5) 인증 — 비밀값이 비어 있을 때 `Bearer undefined`가 통과하지 않는다
//
// 외부 API를 부르지 않기 위해 dueUsers(선정)만 잰다. 실제 조회는 syncUserBreaches가 하고
// 그건 이미 다른 검사가 본다. 선정이 곧 비용의 크기다.
import { PrismaClient } from '@prisma/client';
import { dueUsers, MIN_INTERVAL_HOURS, MAX_PER_RUN } from '../lib/breach-rescan';
import { readFileSync } from 'node:fs';

export {};

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('[abort] DATABASE_URL이 로컬이 아닙니다. 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

const NOW = new Date('2026-08-26T12:00:00Z');
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

async function makeUser(id: string, opts: { accounts: number; checkedHoursAgo: number | null }) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@example.invalid`,
      name: id,
      breachCheckedAt: opts.checkedHoursAgo === null ? null : hoursAgo(opts.checkedHoursAgo),
    },
  });
  for (let i = 0; i < opts.accounts; i += 1) {
    await prisma.account.create({
      data: {
        id: `${id}-a${i}`,
        userId: id,
        name: `서비스${i}`,
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
      },
    });
  }
}

async function main(): Promise<void> {
  await makeUser('rescan-never', { accounts: 1, checkedHoursAgo: null });
  await makeUser('rescan-old', { accounts: 1, checkedHoursAgo: MIN_INTERVAL_HOURS + 5 });
  await makeUser('rescan-recent', { accounts: 1, checkedHoursAgo: 1 });
  await makeUser('rescan-empty', { accounts: 0, checkedHoursAgo: null });

  const due = await dueUsers(NOW);
  const ids = due.map((u) => u.id);

  check(ids.includes('rescan-never'), '1 한 번도 대조하지 않은 사용자는 대상이다');
  check(ids.includes('rescan-old'), `2 ${MIN_INTERVAL_HOURS}시간이 지난 사용자는 대상이다`);
  check(
    !ids.includes('rescan-recent'),
    '3 최근에 본 사용자는 제외한다 — 경과 시간이 비용을 정한다',
  );
  check(
    !ids.includes('rescan-empty'),
    '4 계정이 없는 사용자는 제외한다 — 대조할 대상이 없다',
  );
  check(
    ids.indexOf('rescan-never') < ids.indexOf('rescan-old'),
    '5 가장 오래 안 본 사람부터 본다',
  );

  const capped = await dueUsers(NOW, 1);
  check(capped.length === 1, `6 회당 상한이 지켜진다 (요청 1건 → ${capped.length}건)`);
  check(MAX_PER_RUN > 0 && MAX_PER_RUN <= 100, `7 회당 상한이 정해져 있다 (${MAX_PER_RUN})`);

  // ── 인증 — 비밀값이 비어 있을 때 통과시키지 않는다 ──
  const route = readFileSync('app/api/cron/breach-rescan/route.ts', 'utf8');
  check(
    /if \(secret\) \{/.test(route),
    '8 비밀값이 있을 때만 비교한다 — 빈 값과 대조하면 "Bearer undefined"가 정답이 된다',
  );
  check(
    /header !== `Bearer \$\{secret\}`/.test(route),
    '9 Bearer 형식으로 대조한다',
  );

  // ── 크론이 실제로 등록돼 있는가 ──
  const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    crons?: { path: string; schedule: string }[];
  };
  const job = cfg.crons?.find((c) => c.path === '/api/cron/breach-rescan');
  check(job !== undefined, '10 vercel.json에 크론이 등록돼 있다 — 코드만 있으면 돌지 않는다');
  check(
    job !== undefined && /^\d+ \d+ \* \* \*$/.test(job.schedule),
    `11 하루 한 번이다 (${job?.schedule}) — 유료 조회라 잦으면 그대로 비용이다`,
  );

  console.log(`verify-breach-rescan: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { id: { startsWith: 'rescan-' } } });
    await prisma.$disconnect();
  });
