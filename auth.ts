// Auth.js(next-auth v5) Node 인스턴스 — auth.config(Edge-safe) + DB signIn upsert.
// route handler(Node)에서 import. proxy.ts(Edge)는 auth.config만 쓰므로 Prisma가 Edge에 유입되지 않음.
// 세션 전략: JWT(어댑터 없음 → 도메인 Account 충돌 회피). google sub = 안정 userId.
// env: AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (값은 .env, 커밋 금지).
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { prisma } from '@/lib/prisma';
import { provisionDemoData } from '@/lib/provision-demo';

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
        // 첫 로그인 데모 데이터 프로비저닝(B2) — 본인 소유 24계정을 만들어 둔다.
        // 계정을 이미 가진 사용자는 멱등 skip이라 재로그인이 사용자 데이터를 덮지 않는다.
        const p = await provisionDemoData(prisma, sub, { idPrefix: `u${sub}` });
        if (p.provisioned) {
          console.info(`[auth.signIn] demo data provisioned: user=${sub}, accounts=${p.accounts}`);
        }
      } catch (e) {
        // DB 미연결·프로비저닝 실패여도 로그인(JWT)은 막지 않음. 화면은 기존 폴백이 받는다.
        console.warn('[auth.signIn] User upsert/provision skipped:', (e as Error).message);
      }
      return true;
    },
  },
});
