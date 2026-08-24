// 서비스 단위 집계 — "몇 명이 어떤 서비스를 쓰는가".
//
// 서비스 정규화(D1~D4)를 한 목적이 이 질의다. 지금은 유출이 확인돼도 같은 서비스를 쓰는
// 다른 사용자에게 알릴 방법이 없다. 서비스가 신원을 가지면 그게 가능해진다.
//
// 그런데 이 파일은 **개인정보 보호를 파는 제품이 자기 사용자 데이터를 집계하는 코드**다.
// 방침과 어긋나는 순간 제품 전체가 무너진다. 그래서 세 가지를 구조로 막는다.
//
//   1. 시드는 센다는 선택지 자체가 없다 — 옵션이면 언젠가 켜진다
//   2. 보유자가 k명 미만인 서비스는 애초에 나오지 않는다 (k-익명성)
//   3. 여기서 나가는 값에 사용자 식별자가 없다 — 저장도 하지 않는다
import { prisma } from '@/lib/prisma';

/**
 * k-익명성 하한. 보유자가 이보다 적은 서비스는 집계에 나오지 않는다.
 *
 * 왜 5인가: 계정 하나짜리 서비스는 그 자체로 개인을 지목한다. 둘·셋도 마찬가지로 좁다 —
 * 지인 관계나 조직 단위에서는 "그 셋 중 하나"가 곧 특정이다. 통계 공개 관행에서 흔히 쓰는
 * 하한이 5이고, 이 제품이 다루는 것이 "누가 어디에 가입했는가"라는 점에서 더 낮출 이유가 없다.
 *
 * **낮추지 말 것.** 데이터가 적어 결과가 비는 것은 데이터의 문제이지 k의 문제가 아니다.
 * 결과를 만들려고 k를 내리면 k-익명성은 남지만 익명성은 사라진다.
 */
export const MIN_HOLDERS = 5;

/**
 * 집계에서 제외하는 출처.
 *
 * 시드는 우리가 심은 데모 데이터다. 실측(2026-08-24) 기준 시드 사용자 4명이 **동일한
 * 24계정을 복제로** 받아 갖고 있어서, 포함하면 "8개 서비스를 5명이 함께 쓴다"는 그럴듯한
 * 숫자가 나온다. 전부 우리가 만든 겹침이다. 이걸 집계라고 부르면 이 제품이 반대하는 일을
 * 우리가 하는 것이 된다.
 *
 * 상수로 두되 함수 인자로는 받지 않는다 — 끌 수 있으면 언젠가 꺼진다.
 */
const EXCLUDED_SOURCE = 'seed';

export type ServiceHolding = {
  serviceId: string;
  /** 사람이 확인한 이름이 없으면 도메인, 그것도 없으면 slug. 이름을 지어내지 않는다. */
  label: string;
  /** 표시명을 사람이 확인했는가. false면 화면이 단정해서는 안 된다. */
  verified: boolean;
  category: string;
  /** 보유자 수. 계정 수가 아니라 **서로 다른 사용자 수**다. */
  holders: number;
};

export type AggregateSummary = {
  /** 집계 대상 서비스 총수(시드 제외 후). */
  servicesConsidered: number;
  /** k 게이트를 통과한 서비스 수. */
  servicesPublishable: number;
  /** k 미만이라 가려진 서비스 수. 몇 개가 가려졌는지는 밝힌다 — 그건 개인을 지목하지 않는다. */
  servicesSuppressed: number;
  /** 집계에 기여한 서로 다른 사용자 수(시드 제외). k보다 작으면 어떤 서비스도 통과할 수 없다. */
  contributingUsers: number;
  minHolders: number;
};

/**
 * 보유자 수 기준 서비스 순위. k 미만은 담기지 않는다.
 *
 * 세는 단위가 **DISTINCT userId**인 것이 이 함수에서 가장 중요한 한 줄이다. 계정 수로 세면
 * 한 사람이 같은 서비스에 계정 다섯 개를 가진 것만으로 k를 통과한다 — 게이트는 통과하는데
 * 익명성은 처음부터 없다. 스키마가 (userId, serviceId) 유니크를 걸지 않기로 한 이상
 * (개인용·업무용 계정을 함께 담기 위해) 이 경로는 실제로 열려 있다.
 */
export async function serviceHoldings(limit = 50): Promise<ServiceHolding[]> {
  const rows = await prisma.$queryRaw<
    {
      serviceId: string;
      displayName: string | null;
      domain: string | null;
      slug: string;
      verifiedAt: Date | null;
      category: string;
      holders: bigint;
    }[]
  >`
    SELECT s."id"          AS "serviceId",
           s."displayName" AS "displayName",
           s."domain"      AS "domain",
           s."slug"        AS "slug",
           s."verifiedAt"  AS "verifiedAt",
           s."category"::text AS "category",
           COUNT(DISTINCT a."userId")::bigint AS "holders"
      FROM "Account" a
      JOIN "Service" s ON s."id" = a."serviceId"
     WHERE a."source" <> ${EXCLUDED_SOURCE}::"AccountSource"
     GROUP BY s."id"
    HAVING COUNT(DISTINCT a."userId") >= ${MIN_HOLDERS}
     ORDER BY COUNT(DISTINCT a."userId") DESC, s."slug" ASC
     LIMIT ${limit}
  `;

  return rows.map((r) => ({
    serviceId: r.serviceId,
    label: r.displayName ?? r.domain ?? r.slug,
    verified: r.verifiedAt !== null,
    category: r.category,
    holders: Number(r.holders),
  }));
}

/**
 * 집계가 지금 가능한 상태인지, 얼마나 가려졌는지.
 *
 * 결과가 비어 있을 때 "데이터가 없다"와 "가려서 안 보인다"는 다른 사실이고, 둘을 같은
 * 빈 화면으로 말하면 게이트가 일하고 있다는 것조차 알 수 없다.
 */
export async function aggregateSummary(): Promise<AggregateSummary> {
  const [dist, users] = await Promise.all([
    prisma.$queryRaw<{ holders: bigint; services: bigint }[]>`
      SELECT holders, COUNT(*)::bigint AS services FROM (
        SELECT a."serviceId", COUNT(DISTINCT a."userId")::bigint AS holders
          FROM "Account" a
         WHERE a."serviceId" IS NOT NULL
           AND a."source" <> ${EXCLUDED_SOURCE}::"AccountSource"
         GROUP BY a."serviceId"
      ) t GROUP BY holders
    `,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT a."userId")::bigint AS n
        FROM "Account" a
       WHERE a."serviceId" IS NOT NULL
         AND a."source" <> ${EXCLUDED_SOURCE}::"AccountSource"
    `,
  ]);

  let considered = 0;
  let publishable = 0;
  for (const row of dist) {
    const services = Number(row.services);
    considered += services;
    if (Number(row.holders) >= MIN_HOLDERS) publishable += services;
  }

  return {
    servicesConsidered: considered,
    servicesPublishable: publishable,
    servicesSuppressed: considered - publishable,
    contributingUsers: Number(users[0]?.n ?? 0),
    minHolders: MIN_HOLDERS,
  };
}

/**
 * 유출 사건의 영향 범위 — 그 서비스를 쓰는 사람이 몇 명인가.
 *
 * 설계 문서가 "제품에서 특히 크다"고 꼽은 질의다. 다만 **여기서 돌려주는 것은 수뿐이고,
 * 누구인지는 이 함수가 아는 채로 끝난다.** 알림을 보내는 일이 언젠가 필요해지면 그건
 * 이 함수가 아니라 발송 경로가 자기 근거를 따로 갖고 해야 한다 — 집계용 조회가 명단을
 * 돌려주기 시작하면, 집계라는 이름으로 명단을 뽑는 길이 열린다.
 *
 * k 미만이면 null이다. 0이 아니다 — "없다"와 "말하지 않는다"는 다르다.
 */
export async function serviceHolderCount(serviceId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ holders: bigint }[]>`
    SELECT COUNT(DISTINCT a."userId")::bigint AS holders
      FROM "Account" a
     WHERE a."serviceId" = ${serviceId}
       AND a."source" <> ${EXCLUDED_SOURCE}::"AccountSource"
  `;
  const holders = Number(rows[0]?.holders ?? 0);
  return holders >= MIN_HOLDERS ? holders : null;
}
