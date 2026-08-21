// 서비스 정규화 — 수집한 이름을 Service 신원으로 모은다.
//
// 왜 필요한가
//   Account.name은 자유 문자열이다. 확장이 준 표시명, 메일 스캔이 찾은 도메인, 사용자가
//   직접 친 이름이 같은 칸에 들어간다. 실측(계정 360건)에서 Clerk/clerk.com,
//   Docker/docker.com처럼 **같은 서비스가 표기별로 갈린 쌍이 4개** 나왔다. 사용자가 늘면
//   이 분열은 사용자 수만큼 곱해지고, "몇 명이 어떤 서비스를 쓰는가"를 영영 셀 수 없다.
//
// 이 파일의 제1 규칙: **모르면 합치지 않는다.**
//   문자열이 비슷하다는 이유로 병합하면 naver.com과 navercorp.com, kakao와 kakaopay가
//   한 서비스가 된다. 카탈로그가 둘을 같은 도메인으로 알 때만 합친다. 미매칭은 미매칭으로
//   남기고 사람이 도메인을 부여할 때 합쳐진다. 이 제품에서 오탐은 미발견보다 나쁘다.
import type { PrismaClient } from '@prisma/client';
import { CATALOG, matchService, registrableDomain, isInfraDomain } from './gmail-catalog';

/** 이름이 도메인 모양인가. `hyundaicard.com` → true, `쿠팡` → false. */
export function looksLikeDomain(name: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name.trim());
}

/**
 * 도메인이 없는 이름의 정규화 키.
 *
 * 공백·기호를 걷고 소문자로 내린다. **여기서 하는 일은 같은 문자열을 같게 만드는 것뿐**이고,
 * 다른 문자열을 같게 만들지 않는다. 예를 들어 'Google Drive'와 'google-drive'는 합쳐지지만
 * '구글'과 'Google'은 합쳐지지 않는다 — 그 둘이 같다는 것은 카탈로그만 안다.
 */
export function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_\-.]+/g, '');
}

export type ResolvedService = {
  slug: string;
  domain: string | null;
  displayName: string | null;
  category: 'social' | 'overseas' | 'domestic' | 'unknown';
  /** 카탈로그가 알아본 서비스인가. false면 표시명이 추정이므로 verifiedAt을 남기지 않는다. */
  known: boolean;
};

/**
 * 수집 원문 → Service 신원(순수 함수. DB 접근 없음).
 *
 * 반환값이 null이면 서비스로 만들지 않는다 — 발송 대행 도메인처럼 계정이 아닌 것들이다.
 */
export function resolveServiceIdentity(rawName: string): ResolvedService | null {
  const name = rawName.trim();
  if (!name) return null;

  // 발송 대행 주소는 서비스가 아니다. shopifyemail.com 하나에 서로 다른 쇼핑몰
  // 수십 곳이 뭉개진다(2026-08-05 실측).
  if (looksLikeDomain(name) && isInfraDomain(name)) return null;

  if (looksLikeDomain(name)) {
    const domain = registrableDomain(name);
    const entry = matchService(domain);
    return {
      slug: domain,
      domain,
      // 카탈로그가 알면 표시명을 준다. 모르면 null — 화면은 도메인을 그대로 쓴다.
      displayName: entry?.service ?? null,
      category: entry?.category ?? 'unknown',
      known: entry !== null,
    };
  }

  // 이름만 있는 경우. 카탈로그에서 이름 → 도메인을 역으로 찾으면 도메인 신원으로 승격된다.
  // 이 경로가 'Clerk'과 'clerk.com'을 하나로 만드는 유일한 길이다.
  const byName = findCatalogByName(name);
  if (byName) {
    return {
      slug: byName.domain,
      domain: byName.domain,
      displayName: byName.service,
      category: byName.category,
      known: true,
    };
  }

  return {
    slug: slugifyName(name),
    domain: null,
    displayName: name, // 사용자·플랫폼이 준 이름 그대로. 지어낸 것이 아니다.
    category: 'unknown',
    known: false,
  };
}

/** 카탈로그 역인덱스(이름 → 대표 도메인). 대소문자·공백 차이를 흡수한다. */
function findCatalogByName(
  name: string,
): { service: string; domain: string; category: ResolvedService['category'] } | null {
  const key = slugifyName(name);
  for (const entry of CATALOG) {
    if (slugifyName(entry.service) === key && entry.domains.length > 0) {
      return {
        service: entry.service,
        domain: registrableDomain(entry.domains[0]),
        category: entry.category,
      };
    }
  }
  return null;
}

/**
 * 신원을 DB의 Service로 확정한다(없으면 생성).
 *
 * 경합에 대비해 upsert를 쓴다. 같은 서비스를 두 요청이 동시에 만들면 slug 유니크 제약에
 * 걸려 한쪽이 실패하는데, 그 실패가 사용자에게는 "가져오기 실패"로 보인다.
 */
/**
 * 여러 이름을 한 번에 서비스로 확정하고 `이름 → serviceId` 표를 돌려준다.
 *
 * 수집 경로 세 곳(확장 가져오기·메일 스캔·직접 입력)이 모두 이걸 쓴다. 한 곳이라도
 * 빠지면 그 경로로 들어온 계정만 serviceId가 비어, 백필해 둔 데이터와 갈라진다.
 *
 * 서비스로 만들 수 없는 이름(발송 대행 도메인 등)은 표에 담기지 않는다 — 호출부는
 * `?? null`로 받아 계정만 만들면 된다.
 */
export async function ensureServicesForNames(
  db: Pick<PrismaClient, 'service'>,
  names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // 같은 이름이 여러 번 들어와도 upsert는 한 번만.
  for (const name of new Set(names)) {
    const identity = resolveServiceIdentity(name);
    if (!identity) continue;
    const { id } = await ensureService(db, identity);
    out.set(name, id);
  }
  return out;
}

export async function ensureService(
  db: Pick<PrismaClient, 'service'>,
  identity: ResolvedService,
): Promise<{ id: string }> {
  return db.service.upsert({
    where: { slug: identity.slug },
    // 이미 있으면 건드리지 않는다. 사람이 채운 displayName을 자동 수집이 덮어쓰면
    // 운영 작업이 매번 지워진다.
    update: {},
    create: {
      slug: identity.slug,
      domain: identity.domain,
      displayName: identity.displayName,
      category: identity.category,
      // 카탈로그가 알아본 것만 확인된 표시명으로 본다. 나머지는 추정 상태로 남긴다.
      verifiedAt: identity.known ? new Date() : null,
    },
    select: { id: true },
  });
}
