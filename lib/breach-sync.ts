// 유출 대조 결과를 DB에 반영한다.
//
// 이 파일이 생기기 전까지 Breach 레코드를 만드는 곳은 시드(provision-demo)와 검증
// 스크립트뿐이었다. 화면도 점수 엔진도 유출축을 완전히 지원하는데 데이터가 들어오는
// 문이 없어서, 그 배선 전체가 한 번도 발화하지 못했다.
//
// 라우트가 아니라 lib에 두는 이유: 소유권·멱등 같은 규칙을 가드가 직접 재려면 함수여야 한다.
// 라우트에 두면 검증이 자기 서버에 HTTP를 다시 걸어야 하고, 쿠키가 안 실려 401이 나면서
// 정작 중요한 규칙이 검증에서 빠진다(feedback_internal_auth_api_fetch_401).
import { prisma } from '@/lib/prisma';
import { fetchBreachedAccount, type NormalizedBreach } from '@/lib/hibp-breaches';
import { matchService, registrableDomain } from '@/lib/gmail-catalog';

export type BreachSyncResult = {
  checkedAt: Date;
  found: number; // 조회로 확인된 사건 수
  created: number; // 이번에 새로 저장된 건
  linkedToAccount: number; // 보유 계정과 이어 붙은 건
  services: string[]; // 새로 저장된 사건의 서비스명
};

/**
 * 유출 사건 하나를 사용자의 계정 목록과 이어 본다.
 *
 * 못 찾으면 null을 돌려주고 서비스명만 남긴다(Breach.accountId가 nullable인 이유).
 * **억지로 잇지 않는다** — 유출된 곳과 이름이 비슷한 계정에 갖다 붙이면, 그 계정이
 * 뚫린 적 없는데도 화면에서 뚫린 것으로 보인다. 이 제품에서 오탐은 미발견보다 나쁘다.
 */
function findMatchingAccountId(
  breach: NormalizedBreach,
  accounts: { id: string; name: string }[],
): string | null {
  if (!breach.domain) return null;
  const domain = registrableDomain(breach.domain);

  // 1) 이름 자리에 도메인이 들어 있는 계정(메일 스캔이 이름을 못 찾은 경우가 여기 해당).
  const byDomain = accounts.find((a) => registrableDomain(a.name.toLowerCase()) === domain);
  if (byDomain) return byDomain.id;

  // 2) 카탈로그가 그 도메인의 표시명을 아는 경우 이름으로 대조.
  const entry = matchService(domain);
  if (entry) {
    const byName = accounts.find((a) => a.name === entry.service);
    if (byName) return byName.id;
  }

  return null;
}

/**
 * 사용자 이메일로 유출 이력을 조회해 Breach를 적재한다.
 *
 * 멱등: 같은 (서비스, 유출일) 사건은 다시 만들지 않는다. 재조회는 흔한 동작이고,
 * 중복이 쌓이면 같은 사건이 E축에서 두 번 감점된다.
 *
 * resolved 보존: 이미 "조치 완료"로 표시한 건은 재조회해도 그대로 둔다. HIBP는 사용자가
 * 비밀번호를 바꿨는지 모르므로, 재조회가 사용자의 조치를 되돌려서는 안 된다.
 */
export async function syncUserBreaches(userId: string, email: string): Promise<BreachSyncResult> {
  const found = await fetchBreachedAccount(email);

  const [accounts, existing] = await Promise.all([
    prisma.account.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.breach.findMany({
      where: { userId },
      select: { id: true, service: true, breachDate: true, accountId: true },
    }),
  ]);

  const seen = new Set(existing.map((b) => `${b.service}|${b.breachDate.toISOString()}`));

  const toCreate: {
    userId: string;
    accountId: string | null;
    service: string;
    breachDate: Date;
    exposedFields: string[];
    advice: string;
    severity: 'high' | 'mid' | 'low';
  }[] = [];

  for (const b of found) {
    if (seen.has(`${b.service}|${b.breachDate.toISOString()}`)) continue;
    toCreate.push({
      userId,
      accountId: findMatchingAccountId(b, accounts),
      service: b.service,
      breachDate: b.breachDate,
      exposedFields: b.exposedFields,
      advice: b.advice,
      severity: b.severity,
    });
  }

  const checkedAt = new Date();
  const linkedAccountIds = toCreate
    .map((r) => r.accountId)
    .filter((id): id is string => id !== null);

  await prisma.$transaction([
    ...(toCreate.length > 0 ? [prisma.breach.createMany({ data: toCreate })] : []),
    // Account.breached는 Breach 관계에서 파생되는 캐시 신호다(스키마 주석).
    // 새로 이어 붙은 계정에만 켠다 — 끄는 것은 조치 완료 경로가 할 일이다.
    ...(linkedAccountIds.length > 0
      ? [
          prisma.account.updateMany({
            where: { id: { in: linkedAccountIds }, userId },
            data: { breached: true },
          }),
        ]
      : []),
    // 사건이 0건이어도 시각은 남긴다. **"대조했는데 깨끗함"을 기록하는 것이 이 필드의 목적**이고,
    // 그게 없으면 E축이 다시 "계정만 있으면 만점"으로 돌아간다.
    prisma.user.update({ where: { id: userId }, data: { breachCheckedAt: checkedAt } }),
  ]);

  return {
    checkedAt,
    found: found.length,
    created: toCreate.length,
    linkedToAccount: linkedAccountIds.length,
    services: toCreate.map((r) => r.service),
  };
}

/**
 * 재대조 쿨다운(분).
 *
 * 이 조회는 **유료 API를 부른다.** 버튼을 연타하면 그대로 비용이고, 남이 우리 키로
 * 호출량을 태우는 경로가 된다. 서버리스에서 인메모리 카운터는 인스턴스마다 갈려
 * 실효가 없지만(2026-08-18 판단), 여기서는 그럴 필요가 없다 — 마지막 대조 시각이
 * 이미 DB에 있고, 그게 인스턴스와 무관한 단일 사실이다.
 *
 * 10분으로 둔 이유: 유출 사건은 그보다 자주 늘지 않는다. 리허설에서 몇 번 눌러 보는
 * 것은 막지 않으면서 연타는 걸러지는 폭이다.
 */
export const RESCAN_COOLDOWN_MINUTES = 10;

export type CooldownState = { allowed: boolean; retryAfterSeconds: number };

/** 지금 다시 대조해도 되는가. 남은 시간을 함께 돌려줘 화면이 사실대로 말할 수 있게 한다. */
export async function checkRescanCooldown(userId: string): Promise<CooldownState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { breachCheckedAt: true },
  });
  if (!user?.breachCheckedAt) return { allowed: true, retryAfterSeconds: 0 };

  const elapsedMs = Date.now() - user.breachCheckedAt.getTime();
  const windowMs = RESCAN_COOLDOWN_MINUTES * 60_000;
  if (elapsedMs >= windowMs) return { allowed: true, retryAfterSeconds: 0 };

  return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - elapsedMs) / 1000) };
}

/** 대조를 수행한 적이 있는가. E축 measured 판정의 유일한 근거. */
export async function hasCheckedBreaches(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { breachCheckedAt: true },
  });
  return user?.breachCheckedAt != null;
}
