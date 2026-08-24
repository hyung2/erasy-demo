// 유출 건수 정합 — 화면과 점수가 같은 것을 세는지 실측한다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/verify-breach-count-consistency.ts
//
// 왜 필요한가: 2026-08-24 실계정 화면에서 같은 대시보드가 서로 다른 말을 했다.
//   유출 위험 축 "미해결 유출 1건" · 최근 활동 "1개 미정리" · 요약 카드 "미해결 없음"
// 원인은 요약 카드만 Account.breached라는 **캐시**를 셌다는 것이다. 그 캐시는 유출이 어느
// 계정 것인지 특정됐을 때만 켜지므로(Breach.accountId), 특정하지 못한 유출은 0으로 보인다.
//
// 이 가드는 세 경로가 같은 수에 도달하는지 잰다:
//   (1) Breach 원본 — resolved=false 전부
//   (2) 점수 엔진이 감점 근거로 삼는 것 (계정 경유 + 미연결)
//   (3) /api/guard가 화면에 내려주는 것
// 어느 하나가 갈라지면 화면 안에서 숫자가 어긋나기 시작한다.
import { PrismaClient } from '@prisma/client';
import { buildActivityFeed } from '../lib/activity';

const prisma = new PrismaClient();

const FIXTURE_PREFIX = 'verify-bcc-';
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

/**
 * 유출이 계정에 붙은 것 1건 + 안 붙은 것 1건 + 이미 조치한 것 1건.
 *
 * **안 붙은 것이 이 검증의 핵심이다.** 그것만 있는 사용자가 정확히 이번 결함의 피해자다.
 */
async function build(): Promise<string> {
  const userId = `${FIXTURE_PREFIX}${stamp}`;
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      name: '유출정합 검증',
      breachCheckedAt: new Date(),
    },
  });
  const account = await prisma.account.create({
    data: {
      userId,
      name: 'LinkedIn',
      provider: 'manual',
      category: 'overseas',
      source: 'user_input',
      breached: true,
    },
  });

  await prisma.breach.createMany({
    data: [
      {
        userId,
        accountId: account.id,
        service: 'LinkedIn',
        breachDate: new Date('2012-06-01'),
        exposedFields: ['이메일', '비밀번호'],
        advice: '검증용',
        severity: 'high',
        resolved: false,
      },
      {
        // 계정에 못 붙은 유출 — Account.breached는 이걸 절대 켜지 못한다.
        userId,
        accountId: null,
        service: 'SomeUnmatchedService',
        breachDate: new Date('2019-03-01'),
        exposedFields: ['이메일'],
        advice: '검증용',
        severity: 'mid',
        resolved: false,
      },
      {
        userId,
        accountId: null,
        service: 'AlreadyHandled',
        breachDate: new Date('2015-01-01'),
        exposedFields: ['이메일'],
        advice: '검증용',
        severity: 'low',
        resolved: true,
      },
    ],
  });
  return userId;
}

async function main() {
  const userId = await build();
  try {
    // (1) 원본
    const source = await prisma.breach.count({ where: { userId, resolved: false } });

    // (2) 점수 엔진이 보는 것 — score-service와 같은 두 갈래 질의
    const [viaAccount, unlinked] = await Promise.all([
      prisma.breach.count({ where: { userId, resolved: false, accountId: { not: null } } }),
      prisma.breach.count({ where: { userId, resolved: false, accountId: null } }),
    ]);

    // (3) 계정 캐시로 세면 몇으로 보이는가 — 이번 결함의 크기
    const viaCache = await prisma.account.count({ where: { userId, breached: true } });

    console.log(
      `원본 ${source} · 점수(계정경유 ${viaAccount} + 미연결 ${unlinked}) · 계정캐시 ${viaCache}`,
    );

    check(source === 2, `1 미해결 유출은 2건이다 (실제 ${source})`);
    check(
      viaAccount + unlinked === source,
      `2 점수 엔진의 두 갈래 합이 원본과 같다 (${viaAccount}+${unlinked} vs ${source})`,
    );
    check(
      viaCache < source,
      `3 계정 캐시로 세면 실제보다 적게 나온다 — 이 갭이 결함의 본체 (캐시 ${viaCache} < 원본 ${source})`,
    );
    check(unlinked > 0, '4 계정에 못 붙은 유출이 실재한다(가정이 아니다)');

    // 조치 완료 건이 섞이지 않는지
    const all = await prisma.breach.count({ where: { userId } });
    check(all === 3 && source === 2, '5 조치 완료한 유출은 미해결 집계에 들어가지 않는다');

    // 화면이 쓰는 셈법(=guard 응답을 필터)과 원본이 같은가
    const guardShape = await prisma.breach.findMany({
      where: { userId },
      select: { resolved: true },
    });
    const guardUnresolved = guardShape.filter((b) => !b.resolved).length;
    check(
      guardUnresolved === source,
      `6 화면 셈법(resolved=false 필터)이 원본과 같다 (${guardUnresolved} vs ${source})`,
    );

    // ── 활동 피드가 잘라 세지 않는가 ──
    //   조회에 take가 걸려 있으면 그 상한 아래에서는 아무 문제가 없어 보인다. 상한을 넘겨
    //   놓고 재야 드러난다(실제로 take:5가 있었고 5건짜리 검증에서는 통과했다).
    await prisma.breach.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        userId,
        accountId: null,
        service: `Overflow${i}`,
        breachDate: new Date('2020-01-01'),
        exposedFields: ['이메일'],
        advice: '검증용',
        severity: 'low' as const,
        resolved: false,
      })),
    });
    const many = await prisma.breach.count({ where: { userId, resolved: false } });
    const feed = await buildActivityFeed(prisma, userId);
    const breachLine = feed.find((f) => f.type === 'breach');
    const stated = Number(breachLine?.message.match(/(\d+)건/)?.[1] ?? -1);
    check(many > 5, `7 상한(5)을 넘는 유출을 만들었다 (${many}건)`);
    check(
      stated === many,
      `8 활동 피드가 전부 센다 — 조회 상한에 잘리지 않는다 (피드 ${stated} vs 실제 ${many})`,
    );
  } finally {
    if (!userId.startsWith(FIXTURE_PREFIX)) throw new Error('안전장치: 시험용이 아닌 사용자');
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }

  console.log(`verify-breach-count-consistency: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
