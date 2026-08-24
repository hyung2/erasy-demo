import type { NextConfig } from "next";

// 콘텐츠 보안 정책(CSP).
//
// 지금은 **Report-Only**다. 위반을 보고만 하고 막지는 않는다.
//   08-18에 CSP를 넣지 않은 이유는 "인라인 스타일과 OAuth 왕복을 함께 통과시키려면 실측이
//   필요한데 동결일에 그 실측 없이 켜면 무대에서 깨진다"였다. 그 판단은 지금도 유효하고,
//   달라진 것은 시간이 생겼다는 점뿐이다. 그래서 순서를 지킨다 — 먼저 관측하고, 위반이
//   없는 것을 확인한 뒤에 enforce로 올린다. 켜는 날짜보다 안 깨지는 것이 중요하다.
//
// 브라우저가 직접 닿는 외부는 셋뿐이다.
//   jsdelivr             — SUIT 폰트 · simple-icons 아이콘
//   api.pwnedpasswords   — 비밀번호 해시 앞 5자 대조(원문은 우리 서버를 거치지 않는다)
//   accounts.google.com  — Gmail 스캔의 Google Identity Services
// Gmail API 자체는 서버가 부른다(app/api/scan/gmail). 브라우저는 우리 라우트만 본다.
const cspDirectives = [
  "default-src 'self'",
  // Next는 하이드레이션 부트스트랩을 인라인 스크립트로 심는다. nonce로 바꾸려면 미들웨어가
  // 매 요청 헤더를 다시 써야 해서, 지금 단계에서 얻는 것보다 깨질 자리가 많다.
  // accounts.google.com — Gmail 스캔이 Google Identity Services를 여기서 받아 온다.
  //   버튼을 눌러야 로드되므로 화면을 훑는 관측에서는 잡히지 않았다. 정책에 없는 채로
  //   enforce로 올렸다면 데모의 핵심 기능이 그 자리에서 깨졌을 것이다(2026-08-24 발견).
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  // 인라인 style 속성 40여 곳(게이지 폭 등 계산값). 정적 클래스로 옮길 수 없는 값들이다.
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "img-src 'self' data: https://cdn.jsdelivr.net",
  // HIBP range는 브라우저가 직접 부른다 — 비밀번호가 우리 서버를 거치지 않게 하려는 설계라
  // 여기를 닫으면 그 보장이 깨진다.
  "connect-src 'self' https://api.pwnedpasswords.com https://accounts.google.com",
  // GIS가 토큰 발급 과정에서 자체 프레임을 쓴다. default-src 'self'가 폴백이라
  // frame-src를 따로 적지 않으면 그 프레임이 막힌다.
  "frame-src 'self' https://accounts.google.com",
  // X-Frame-Options SAMEORIGIN과 같은 뜻으로 맞춘다(둘이 다르면 frame-ancestors가 이긴다).
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

// 보안 응답 헤더. 계정 인벤토리를 다루는 화면이라 최소한의 브라우저 측 방어는 켜 둔다.
const securityHeaders = [
  // 로그인·인벤토리 화면이 남의 페이지에 끼워져 클릭재킹 미끼가 되지 않게 한다.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 외부로 나갈 때 경로를 흘리지 않는다(계정 id가 경로에 실릴 수 있다).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 쓰지 않는 장치 권한은 애초에 요청조차 못 하게 닫는다.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Vercel이 이미 붙이지만, 다른 호스팅으로 옮겨도 유지되도록 설정에 명시해 둔다.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy-Report-Only", value: cspDirectives },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
