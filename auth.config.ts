// Auth.js v5 공유 설정 — Edge-safe(Prisma·Node 전용 코드 없음).
// proxy.ts(Edge)와 auth.ts(Node)가 공유. DB를 쓰는 signIn upsert는 auth.ts에만 둔다.
// 세션 전략: JWT(어댑터 없음 → 도메인 Account 이름 충돌 회피). google sub를 안정 userId로 사용.
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // 로그인 인증 전용 최소 scope. 강력 scope·연결앱 조회 금지(T1.1 스파이크 결정).
      // prompt=select_account: 로그아웃 후 재로그인 시 구글 계정 선택 화면 강제(다른 계정 접속 허용).
      authorization: {
        params: { scope: 'openid email profile', prompt: 'select_account' },
      },
    }),
  ],
  callbacks: {
    // token.sub = google sub(JWT 전략 기본). 세션에 안정 userId로 노출.
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
