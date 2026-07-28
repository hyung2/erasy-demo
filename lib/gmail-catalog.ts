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
import type { Category } from './dummy-data';

export type CatalogEntry = {
  /** 화면에 쓰는 서비스명 — 시드(dummy-data)와 표기를 일치시킨다. */
  service: string;
  category: Category;
  /** 발신 도메인. 서브도메인은 접미사 매칭이라 `netflix.com`이 `mailer.netflix.com`도 잡는다. */
  domains: string[];
};

// 국내·해외 주요 서비스. 데모 서사(간편가입·해외구독·오래된 국내 계정)를 커버하는 선에서 유지한다.
// 무한정 늘리면 오탐(마케팅 대행사 도메인 공유)이 늘어 정직성만 나빠진다.
export const CATALOG: CatalogEntry[] = [
  // 국내 — 간편가입·커머스·금융
  { service: '네이버', category: 'domestic', domains: ['naver.com', 'navercorp.com'] },
  { service: '카카오톡', category: 'domestic', domains: ['kakao.com', 'kakaocorp.com'] },
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
  { service: 'Apple Music', category: 'overseas', domains: ['apple.com', 'email.apple.com'] },
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
 * From 헤더에서 발신 도메인만 뽑는다.
 * 예) `Netflix <info@mailer.netflix.com>` → `mailer.netflix.com`
 * 표시이름에 괄호·따옴표가 섞여도 마지막 `@` 뒤만 취해 안전하게 처리한다.
 */
export function extractDomain(fromHeader: string): string | null {
  const angle = fromHeader.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : fromHeader).trim();
  const at = addr.lastIndexOf('@');
  if (at < 0) return null;
  const domain = addr
    .slice(at + 1)
    .replace(/[>,;\s].*$/, '')
    .trim()
    .toLowerCase();
  return domain.includes('.') ? domain : null;
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

/** Gmail 검색 질의 — 해당 서비스가 보낸 메일 중 가장 최근 1건. */
export function queryFor(entry: CatalogEntry): string {
  return entry.domains.map((d) => `from:${d}`).join(' OR ');
}
