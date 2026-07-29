// Gmail 스캔 대상 서비스 카탈로그 — 발신 도메인 → 서비스 식별.
//
// 왜 카탈로그인가: Gmail API는 "가입한 서비스 목록"을 주지 않는다. 우리가 가진 건 받은 메일의
// 발신자뿐이라, **알림 메일을 보내는 도메인**을 서비스로 되짚는 방식이 유일한 자동 발견 경로다.
// 기술검토 v2 3.2·6장(발견 삼각형)의 "메일함 자동 스캔" 경로 구현체.
//
// 정직성 한계(화면·발표에 그대로 노출할 것)
//  - 여기 없는 서비스는 발견되지 않는다. 카탈로그 밖 = 미발견이지 "없음"이 아니다.
//  - 최신 수신일은 **활동 추정치**이지 실제 로그인일이 아니다. 광고 메일만 받아도 최근값이 된다.
//  - Gmail 사용자만 해당. 네이버·카카오 메일함은 API 부재로 딥링크 경로로 분기한다.
//  - 개인 메일 도메인(naver.com·kakao.com)은 발신 전용 주소에서 온 메일만 서비스로 친다.
//    지인이 보낸 메일 한 통이 "가입"으로 집계되면 결과가 맞아도 근거가 틀린다(이슈 #4).
import type { Category } from './dummy-data';

/**
 * 발신자 판정 정책.
 *  - `any`: 도메인이 곧 그 회사 것이다. 도메인만 맞으면 서비스로 인정한다.
 *  - `service-only`: 일반인의 개인 메일 주소로도 쓰이는 도메인. **발신 전용 로컬파트**일 때만 인정한다.
 */
export type SenderPolicy = 'any' | 'service-only';

export type CatalogEntry = {
  /** 화면에 쓰는 서비스명 — 시드(dummy-data)와 표기를 일치시킨다. */
  service: string;
  category: Category;
  /** 발신 도메인. 서브도메인은 접미사 매칭이라 `netflix.com`이 `mailer.netflix.com`도 잡는다. */
  domains: string[];
  /** 생략 시 `any`. 개인 메일 도메인에만 `service-only`를 건다. */
  senderPolicy?: SenderPolicy;
  /** 과거 표기 — 개명해도 인벤토리의 옛 이름이 중복 계정으로 잡히지 않게 한다. */
  aliases?: string[];
};

/**
 * 발신 전용(답장받지 않는) 주소에 흔히 쓰이는 로컬파트 토큰.
 * 서비스 알림은 이런 주소에서 오고, 지인 메일은 오지 않는다 — 이 비대칭이 판별의 근거다.
 * 판정은 두 갈래다. (1) 구분자를 지운 통짜 문자열이 목록에 있는가 — `no-reply` → `noreply`.
 * (2) 구분자(`.` `_` `-` `+`)로 쪼갠 토큰 중 하나가 목록에 있는가 — `naver_notice` → `notice`.
 * 토큰 목록에 `no`·`reply` 같은 조각을 넣지 않는 이유: `no.jaehyun@naver.com`(성이 '노'인 사람)이
 * 발신 전용으로 잘못 인정된다. 조각은 (1)의 통짜 검사로만 흡수한다.
 */
const SERVICE_LOCALPART_TOKENS = new Set([
  'noreply',
  'noreplies',
  'donotreply',
  'notice',
  'notify',
  'notification',
  'notifications',
  'info',
  'support',
  'help',
  'service',
  'admin',
  'master',
  'news',
  'newsletter',
  'alert',
  'alerts',
  'security',
  'account',
  'accounts',
  'billing',
  'cs',
  'mail',
  'mailer',
  'member',
  'official',
]);

// 국내·해외 주요 서비스. 데모 서사(간편가입·해외구독·오래된 국내 계정)를 커버하는 선에서 유지한다.
// 무한정 늘리면 오탐(마케팅 대행사 도메인 공유)이 늘어 정직성만 나빠진다.
export const CATALOG: CatalogEntry[] = [
  // 국내 — 간편가입·커머스·금융
  // naver.com·kakao.com은 개인 메일 주소 도메인이기도 하다 → 발신 전용 주소만 서비스로 친다.
  {
    service: '네이버',
    category: 'domestic',
    domains: ['naver.com', 'navercorp.com'],
    senderPolicy: 'service-only',
  },
  {
    service: '카카오톡',
    category: 'domestic',
    domains: ['kakao.com', 'kakaocorp.com'],
    senderPolicy: 'service-only',
  },
  { service: '카카오페이', category: 'domestic', domains: ['kakaopay.com'] },
  { service: '쿠팡', category: 'domestic', domains: ['coupang.com'] },
  { service: '배달의민족', category: 'domestic', domains: ['baemin.com', 'woowahan.com'] },
  { service: '토스', category: 'domestic', domains: ['toss.im', 'tossbank.com'] },
  { service: '11번가', category: 'domestic', domains: ['11st.co.kr', '11stcorp.com'] },
  { service: '멜론', category: 'domestic', domains: ['melon.com'] },
  { service: '인터파크', category: 'domestic', domains: ['interpark.com'] },
  { service: '요기요', category: 'domestic', domains: ['yogiyo.co.kr'] },
  { service: '무신사', category: 'domestic', domains: ['musinsa.com'] },
  { service: '당근', category: 'domestic', domains: ['daangn.com'] },
  { service: 'G마켓', category: 'domestic', domains: ['gmarket.co.kr'] },
  { service: 'SSG닷컴', category: 'domestic', domains: ['ssg.com'] },
  { service: '야놀자', category: 'domestic', domains: ['yanolja.com'] },

  // 소셜·플랫폼
  { service: 'YouTube', category: 'social', domains: ['youtube.com'] },
  { service: 'Google Drive', category: 'social', domains: ['drive.google.com'] },
  { service: 'LinkedIn', category: 'social', domains: ['linkedin.com'] },
  { service: 'Instagram', category: 'social', domains: ['instagram.com', 'mail.instagram.com'] },
  { service: 'Facebook', category: 'social', domains: ['facebookmail.com'] },
  { service: 'X (Twitter)', category: 'social', domains: ['x.com', 'twitter.com'] },
  { service: 'Discord', category: 'social', domains: ['discord.com'] },
  { service: 'Notion', category: 'social', domains: ['notion.so', 'makenotion.com'] },
  { service: 'Medium', category: 'social', domains: ['medium.com'] },
  { service: 'Quora', category: 'social', domains: ['quora.com'] },
  { service: 'GitHub', category: 'social', domains: ['github.com'] },

  // 해외 구독·커머스
  { service: 'Netflix', category: 'overseas', domains: ['netflix.com'] },
  { service: 'Spotify', category: 'overseas', domains: ['spotify.com'] },
  { service: 'Amazon', category: 'overseas', domains: ['amazon.com', 'amazon.co.jp'] },
  // apple.com에서 오는 건 Apple ID 보안 알림·App Store 영수증이 대부분이다.
  // 이걸 'Apple Music'으로 찍으면 근거가 틀린다 → 도메인이 실제로 증명하는 범위(계정)로 넓힌다.
  // aliases: 시드·기존 인벤토리의 옛 표기가 중복 계정으로 잡히지 않게 흡수한다.
  {
    service: 'Apple 계정',
    category: 'overseas',
    domains: ['apple.com', 'email.apple.com'],
    aliases: ['Apple Music'],
  },
  { service: 'Disney+', category: 'overseas', domains: ['disneyplus.com'] },
  { service: 'Adobe', category: 'overseas', domains: ['adobe.com'] },
  { service: 'Dropbox', category: 'overseas', domains: ['dropbox.com'] },
  { service: 'Airbnb', category: 'overseas', domains: ['airbnb.com'] },
  { service: 'Booking.com', category: 'overseas', domains: ['booking.com'] },
  { service: 'Uber', category: 'overseas', domains: ['uber.com'] },
];

/** 도메인 → 카탈로그 항목 역인덱스. 접미사 매칭을 위해 도메인 목록을 그대로 보관한다. */
const BY_DOMAIN: Array<{ domain: string; entry: CatalogEntry }> = CATALOG.flatMap((entry) =>
  entry.domains.map((domain) => ({ domain, entry })),
);

/**
 * From 헤더에서 발신 주소를 로컬파트·도메인으로 가른다.
 * 예) `Netflix <info@mailer.netflix.com>` → `{ localPart: 'info', domain: 'mailer.netflix.com' }`
 * 표시이름에 괄호·따옴표가 섞여도 마지막 `@`를 기준으로 갈라 안전하게 처리한다.
 */
export function extractAddress(fromHeader: string): { localPart: string; domain: string } | null {
  const angle = fromHeader.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : fromHeader).trim();
  const at = addr.lastIndexOf('@');
  if (at < 0) return null;

  const domain = addr
    .slice(at + 1)
    .replace(/[>,;\s].*$/, '')
    .trim()
    .toLowerCase();
  if (!domain.includes('.')) return null;

  // 표시이름이 따옴표 없이 붙어 있는 경우(`토스 noreply@toss.im`)를 대비해 마지막 공백 뒤만 취한다.
  const localPart = addr
    .slice(0, at)
    .replace(/^.*[\s<"']/, '')
    .trim()
    .toLowerCase();
  return { localPart, domain };
}

/**
 * From 헤더에서 발신 도메인만 뽑는다. `extractAddress`의 도메인 부분과 동일하다.
 */
export function extractDomain(fromHeader: string): string | null {
  return extractAddress(fromHeader)?.domain ?? null;
}

/**
 * 발신 전용(답장받지 않는) 주소인가. 개인 메일 도메인에서 서비스 알림만 골라내는 판별식이다.
 * 빈 로컬파트는 판별 불가이므로 인정하지 않는다 — 모르면 제외가 정직한 기본값이다.
 */
export function isServiceSender(localPart: string): boolean {
  const lower = localPart.toLowerCase();
  if (!lower) return false;

  // (1) 구분자를 지운 통짜 검사 — `no-reply`·`do_not_reply` 계열을 흡수한다.
  if (SERVICE_LOCALPART_TOKENS.has(lower.replace(/[._\-+]/g, ''))) return true;

  // (2) 토큰 검사 — `naver_notice`처럼 서비스 토큰이 섞인 주소를 잡는다.
  return lower.split(/[._\-+]/).some((token) => token && SERVICE_LOCALPART_TOKENS.has(token));
}

/**
 * 발신 도메인을 카탈로그 서비스로 매칭. 접미사 매칭이라 서브도메인 발신을 잡는다.
 * `evil-netflix.com`처럼 상표를 끼워 넣은 도메인은 경계(`.`) 검사로 걸러진다.
 */
export function matchService(domain: string): CatalogEntry | null {
  let best: { entry: CatalogEntry; len: number } | null = null;
  for (const { domain: cand, entry } of BY_DOMAIN) {
    if (domain === cand || domain.endsWith(`.${cand}`)) {
      // 가장 구체적인(긴) 도메인 매칭을 채택 — drive.google.com이 google.com보다 우선.
      if (!best || cand.length > best.len) best = { entry, len: cand.length };
    }
  }
  return best?.entry ?? null;
}

/** 발신자 판정 결과. 제외 사유를 구분해야 화면에 정직하게 표기할 수 있다. */
export type SenderVerdict =
  /** 서비스 알림으로 인정 */
  | { kind: 'service'; entry: CatalogEntry; domain: string }
  /** 카탈로그에는 있으나 개인 메일로 판단해 제외 (예: `hong@naver.com`) */
  | { kind: 'personal'; entry: CatalogEntry; domain: string }
  /** 카탈로그 밖 도메인 */
  | { kind: 'unmatched'; domain: string }
  /** 주소를 파싱하지 못함 */
  | { kind: 'invalid' };

/**
 * From 헤더 한 줄을 판정한다. 도메인 매칭에 **발신자 정책**을 얹은 것이 `matchService`와의 차이다.
 * 오탐(지인 메일 → 가입)을 막는 지점이 여기이며, 결과의 `personal`은 버리지 않고 카운트로 노출한다.
 */
export function matchSender(fromHeader: string): SenderVerdict {
  const addr = extractAddress(fromHeader);
  if (!addr) return { kind: 'invalid' };

  const entry = matchService(addr.domain);
  if (!entry) return { kind: 'unmatched', domain: addr.domain };

  if (entry.senderPolicy === 'service-only' && !isServiceSender(addr.localPart)) {
    return { kind: 'personal', entry, domain: addr.domain };
  }
  return { kind: 'service', entry, domain: addr.domain };
}

/** 해당 서비스의 과거 표기(개명 이력). 인벤토리 대조에서 중복 계정을 막는 데 쓴다. */
export function aliasesFor(service: string): string[] {
  return CATALOG.find((e) => e.service === service)?.aliases ?? [];
}

/**
 * Gmail 검색 질의 — 해당 서비스가 보낸 메일.
 *
 * 개인 메일 도메인이어도 질의는 도메인 전체로 던진다. 발신 전용 주소를 질의에 박아 넣으면
 * 목록에 없는 주소(`naver_notice@…` 같은 변종)를 통째로 놓쳐 **미발견**이 된다.
 * 넓게 받아 서버에서 거르는 쪽이 안전하다 — 판정의 SSOT는 `matchSender`다.
 */
export function queryFor(entry: CatalogEntry): string {
  return entry.domains.map((d) => `from:${d}`).join(' OR ');
}

/**
 * 조회할 후보 메일 건수. 개인 메일 도메인은 최신 1건이 지인 메일일 수 있어 여러 건을 훑는다.
 * 1건만 보면 "지인 메일이 최신이라 네이버가 미발견" 같은 2차 오류가 생긴다.
 */
export function candidateCountFor(entry: CatalogEntry): number {
  return entry.senderPolicy === 'service-only' ? 10 : 1;
}
