// 정기 자동 대조 — 사용자가 누르지 않아도 유출 이력을 다시 본다.
//
// 왜 필요한가: 유출 대조는 지금까지 **사용자가 버튼을 눌러야만** 돌았다. 그런데 유출은
// 사용자가 우리 화면에 들어와 있는 동안에만 일어나지 않는다. 한 번 확인하고 안 들어오면
// 그 뒤에 터진 사건은 영영 모른다. 사업계획서가 말한 "지킨다"가 서 있으려면 우리가 먼저
// 봐야 한다.
//
// **이 조회는 유료 API를 부른다.** 그래서 게이트를 세 겹으로 둔다.
//   1) 대상 축소 — 계정을 하나라도 가진 사용자만. 빈 계정은 대조할 대상이 없다.
//   2) 간격 — 마지막 대조로부터 MIN_INTERVAL_HOURS가 지난 사용자만.
//      이 게이트가 DB에 있는 것이 중요하다. 라우트가 몇 번 불리든, 어느 인스턴스에서
//      돌든, 비용은 이 간격으로만 발생한다. 호출 횟수가 아니라 **경과 시간**이 비용을 정한다.
//   3) 회당 상한 — 한 번에 MAX_PER_RUN명까지. 사용자가 늘어도 한 번의 실행이 무한정
//      길어지거나 비싸지지 않는다. 남은 사람은 다음 실행이 가져간다.
//
// 실패는 사용자별로 격리한다. 한 사람의 조회가 한도에 걸렸다고 나머지를 못 보면,
// 알림이 필요한 사람이 앞사람 사정으로 못 받는다.
import { prisma } from './prisma';
import { syncUserBreaches } from './breach-sync';
import { MIN_INTERVAL_HOURS } from './rescan-schedule';

// 간격은 주기 정본(lib/rescan-schedule.ts)에 있다 — 크론 표현식·화면 표기와 같은 곳을 본다.
// 여기서 다시 내보내는 것은 기존 소비자(가드·크론 라우트)의 import 경로를 그대로 두기 위해서다.
export { MIN_INTERVAL_HOURS };

/** 한 번의 실행에서 볼 최대 인원. */
export const MAX_PER_RUN = 25;

export type RescanOutcome = {
  scanned: number;
  created: number;
  skipped: number;
  failed: { userId: string; reason: string }[];
};

/** 지금 다시 볼 때가 된 사용자. 이메일이 없으면 대조할 키가 없으므로 제외한다. */
export async function dueUsers(now: Date, limit = MAX_PER_RUN) {
  const cutoff = new Date(now.getTime() - MIN_INTERVAL_HOURS * 3_600_000);
  return prisma.user.findMany({
    where: {
      email: { not: '' },
      accounts: { some: {} },
      OR: [{ breachCheckedAt: null }, { breachCheckedAt: { lt: cutoff } }],
    },
    select: { id: true, email: true },
    // 가장 오래 안 본 사람부터. null이 먼저 온다(한 번도 안 본 사람).
    orderBy: { breachCheckedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  });
}

/**
 * 대상자를 순차로 대조한다.
 *
 * 순차인 이유: 상대 API에 한도가 있고, 우리가 동시에 몰아치면 429를 자초한다.
 * 대상이 회당 25명이라 순차로도 오래 걸리지 않는다.
 */
export async function rescanDueUsers(now: Date = new Date()): Promise<RescanOutcome> {
  const users = await dueUsers(now);
  const out: RescanOutcome = { scanned: 0, created: 0, skipped: 0, failed: [] };

  for (const u of users) {
    try {
      const r = await syncUserBreaches(u.id, u.email);
      out.scanned += 1;
      out.created += r.created;
    } catch (e) {
      // 한 사람의 실패가 나머지를 막지 않는다. 사유는 남기되 이메일은 남기지 않는다.
      out.failed.push({ userId: u.id.slice(0, 6), reason: (e as Error).message.slice(0, 80) });
    }
  }
  return out;
}
