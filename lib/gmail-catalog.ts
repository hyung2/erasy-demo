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
/**
 * 개인 메일함으로 널리 쓰이는 도메인. 카탈로그 밖 도메인을 서비스로 인정하는 개방 모드에서
 * **여기 있는 도메인만 발신 전용 주소 조건을 요구**한다(지인 메일을 가입으로 세지 않기 위해).
 * 그 밖의 낯선 도메인은 가입·인증 문구로 걸린 메일의 발신자이므로 서비스로 본다.
 */
const WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'naver.com',
  'kakao.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  'hotmail.com',
  'outlook.com',
  'outlook.kr',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.jp',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'hanmir.com',
  'korea.com',
  'empas.com',
]);

/**
 * **남을 대신해 메일을 보내는 도메인.** 여기서 온 메일은 가입 사실을 증명하지만
 * *어느 서비스에 가입했는지*는 알려주지 않는다 — 발송 대행사의 주소이기 때문이다.
 *
 * 담으면 안 되는 이유가 두 가지다. (1) 사용자가 가입한 적 없는 회사가 계정 목록에 뜬다.
 * (2) 더 나쁜 건 뭉개짐이다 — `shopifyemail.com` 하나에 서로 다른 쇼핑몰 수십 곳이
 * 한 줄로 접힌다. 실계정 측정에서 실제로 이 오염이 확인됐다(2026-08-05: 61곳 중 다수).
 *
 * 버리지 않고 **제외했다는 사실과 도메인을 화면에 남긴다** — 못 찾은 것과 없는 것은 다르다.
 */
const INFRA_DOMAINS = new Set([
  // 트랜잭션·마케팅 메일 발송 대행(ESP)
  'sendgrid.net',
  'mailgun.org',
  'mailgun.net',
  'mandrillapp.com',
  'mailchimp.com',
  'mcsv.net',
  'sparkpostmail.com',
  'postmarkapp.com',
  'sendinblue.com',
  'brevo.com',
  'klaviyomail.com',
  'shopifyemail.com',
  'createsend.com',
  'hubspotemail.net',
  'replicate.email',
  'sparkpost.com',
  'amazonses.com',
  'stibee.com',
  // 클라우드·플랫폼 인프라(서비스 자체가 아니라 알림 경로)
  'amazonaws.com',
  'cloudfront.net',
  'microsoftonline.com',
  'azurecomm.net',
  'notifications.google.com',
  // 결제 인프라 — 가맹점을 대신해 보낸다
  'link.com',
  'stripe.com',
  'paypal-communication.com',
]);

/** `co.kr`처럼 2단계 국가 TLD — 등록 가능 도메인을 자를 때 한 칸 더 남긴다. */
const MULTI_LEVEL_TLDS = new Set([
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr', 'ac.kr',
  'co.jp', 'ne.jp', 'or.jp', 'co.uk', 'org.uk', 'ac.uk',
  'com.au', 'com.br', 'com.cn', 'com.tw', 'com.hk', 'com.sg',
]);

/**
 * 발신 도메인 → 등록 가능 도메인. `mailer.notice.ridibooks.com` → `ridibooks.com`.
 * 이걸 안 하면 같은 서비스가 서브도메인마다 다른 계정으로 쌓인다.
 */
export function registrableDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LEVEL_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

/**
 * 이 이름·도메인이 발송 대행 주소인가. 이미 인벤토리에 담긴 오염 항목을 걷어낼 때도 쓴다
 * (개방 모드 도입 전에 저장된 계정은 이 판정을 거치지 않았다).
 */
export function isInfraDomain(nameOrDomain: string): boolean {
  return INFRA_DOMAINS.has(registrableDomain(nameOrDomain.trim().toLowerCase()));
}

/** 개방 모드 판정 결과. 카탈로그에 없으면 도메인 자체를 서비스명 후보로 돌려준다. */
export type OpenSenderVerdict =
  | { kind: 'invalid' }
  | { kind: 'personal'; domain: string }
  /** 발송 대행 도메인 — 가입은 했으나 어느 서비스인지 특정 불가. 담지 않고 사실만 남긴다. */
  | { kind: 'infra'; domain: string }
  /** 카탈로그 적중 — 표시명·분류를 사전에서 가져온다. */
  | { kind: 'known'; entry: CatalogEntry; domain: string }
  /** 카탈로그 밖 — 이름을 지어내지 않고 등록 가능 도메인을 그대로 후보명으로 쓴다. */
  | { kind: 'discovered'; name: string; domain: string };

/**
 * 가입·인증 문구로 걸린 메일의 발신자를 서비스로 환원한다(A1 개방 모드).
 *
 * `matchSender`와 다른 점: 카탈로그에 없는 도메인을 버리지 않는다. 카탈로그는 발견의 필터가
 * 아니라 **표시명·분류 사전**으로 역할이 바뀐다 — `lib/connection-import.ts`가 이미 쓰는 정책이며,
 * 이걸로 두 발견 경로의 정책이 통일된다. 카탈로그 의존이 남아 있는 동안 재현율 상한이
 * 목록 크기(36)에 하드코딩돼 있었다(2026-08-04 실측: 실계정에서 6곳만 발견, 질의 9건 실패).
 *
 * 정밀도 방어는 그대로 유지한다 — 개인 메일 도메인은 발신 전용 로컬파트일 때만 인정한다.
 */
export function resolveOpenSender(fromHeader: string): OpenSenderVerdict {
  const addr = extractAddress(fromHeader);
  if (!addr) return { kind: 'invalid' };

  const entry = matchService(addr.domain);
  if (entry) {
    if (entry.senderPolicy === 'service-only' && !isServiceSender(addr.localPart)) {
      return { kind: 'personal', domain: addr.domain };
    }
    return { kind: 'known', entry, domain: addr.domain };
  }

  const registrable = registrableDomain(addr.domain);
  // 카탈로그 밖이지만 개인 메일함 도메인이면 발신 전용 주소만 서비스로 인정한다.
  if (WEBMAIL_DOMAINS.has(registrable) && !isServiceSender(addr.localPart)) {
    return { kind: 'personal', domain: addr.domain };
  }
  // 발송 대행 도메인은 "어느 서비스인지"를 알려주지 않는다. 담으면 가입한 적 없는 회사가
  // 목록에 뜨고, 서로 다른 가맹점이 한 줄로 뭉개진다.
  if (INFRA_DOMAINS.has(registrable)) {
    return { kind: 'infra', domain: registrable };
  }
  return { kind: 'discovered', name: registrable, domain: addr.domain };
}

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
/**
 * 개방 모드 질의어 — "아는 서비스의 도메인"이 아니라 **가입·인증 메일의 문구**로 찾는다.
 *
 * 검색은 구글 서버가 수행하고 우리가 받는 것은 지금과 동일하게 From·Date 헤더뿐이다.
 * scope도 `gmail.readonly` 그대로이므로 추가 권한이 없다.
 *
 * 문구 선정 원칙: 가입 시점에만 오는 말을 고른다. `인증번호`는 은행·2FA·주문확인 등
 * 가입과 무관한 메일에 광범위하게 쓰여 제외했다(오탐이 미발견보다 낫다는 뜻이 아니라,
 * 발신 도메인 집계 단계에서 걸러낼 수 없는 종류의 잡음이기 때문이다). 필요하면 여기서 조정한다.
 */
export const OPEN_SCAN_PHRASES = [
  '회원가입',
  '가입이 완료',
  '가입을 환영',
  '가입해 주셔서',
  '이메일 인증',
  '이메일 주소 인증',
  '가입 확인',
  'welcome to',
  'verify your email',
  'confirm your email',
  'complete your registration',
  'activate your account',
] as const;

/** 개방 모드 Gmail 질의문. lookback은 호출부가 붙인다. */
export function openScanQuery(): string {
  return OPEN_SCAN_PHRASES.map((p) => `"${p}"`).join(' OR ');
}

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
