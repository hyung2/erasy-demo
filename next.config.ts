import type { NextConfig } from "next";

// 보안 응답 헤더. 계정 인벤토리를 다루는 화면이라 최소한의 브라우저 측 방어는 켜 둔다.
// CSP는 넣지 않았다 — 인라인 스타일과 OAuth 리다이렉트를 함께 통과시키려면 실측이 필요한데,
// 기능 동결일(08-18)에 그 실측 없이 켜면 데모 당일에 깨질 자리가 생긴다. 로드맵으로 남긴다.
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
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
