// Auth.js(next-auth v5) Node 인스턴스 — auth.config(Edge-safe) + DB signIn upsert.
// route handler(Node)에서 import. proxy.ts(Edge)는 auth.config만 쓰므로 Prisma가 Edge에 유입되지 않음.
// 세션 전략: JWT(어댑터 없음 → 도메인 Account 충돌 회피). google sub = 안정 userId.
// env: AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (값은 .env, 커밋 금지).
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { prisma } from '@/lib/prisma';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // 최초/재로그인 시 도메인 User upsert(google sub 기준). 자격증명·provider 토큰 미저장.
    // signIn 콜백은 실제 로그인 흐름(Node route)에서만 실행 → Edge proxy에는 영향 없음.
    async signIn({ user, account }) {
      const sub = account?.providerAccountId ?? user.id;
      const email = user.email;
      if (!sub || !email) return false;
      try {
        await prisma.user.upsert({
          where: { id: sub },
          update: { email, name: user.name ?? null },
          create: { id: sub, email, name: user.name ?? null },
        });
      } catch (e) {
        // DB 미연결이어도 로그인(JWT)은 막지 않음. 데이터는 이후 동기화.
        console.warn('[auth.signIn] User upsert skipped:', (e as Error).message);
      }
      return true;
    },
  },
});
