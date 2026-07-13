// 보호 라우트 Proxy (T2.1/H1). Next 16 proxy 규약 + Auth.js v5(Edge).
// auth.config만 사용 → Prisma가 Edge 번들에 유입되지 않음(auth.ts는 import하지 않는다).
// 미인증 접근 시 로그인('/')으로 리다이렉트. 실동작은 env 시크릿 도착 후 실측.
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  if (!req.auth) {
    return Response.redirect(new URL('/', req.nextUrl.origin));
  }
  // 인증됨 → 통과(undefined 반환).
});

// 인증 보호 대상 앱 라우트. auth 콜백·정적 자원·랜딩(/)·스캔 연출은 제외.
export const config = {
  matcher: ['/dashboard/:path*', '/scan/:path*', '/breach/:path*', '/cleanup/:path*'],
};
