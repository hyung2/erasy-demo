// Auth.js(next-auth v5) Node 인스턴스 — auth.config(Edge-safe) + Credentials provider + DB signIn upsert.
// route handler(Node)에서 import. proxy.ts(Edge)는 auth.config만 쓰므로 Prisma가 Edge에 유입되지 않음.
// 세션 전략: JWT(어댑터 없음 → 도메인 Account 충돌 회피).
// userId 규약: 구글 = google sub / 자체 가입 = User.id(cuid). 둘 다 token.sub로 실려 동일하게 스코핑된다.
// env: AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (값은 .env, 커밋 금지).
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { prisma } from '@/lib/prisma';
import { provisionDemoData } from '@/lib/provision-demo';
import { normalizeEmail, verifyPassword } from '@/lib/password';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    // 자체 가입 로그인. Prisma·scrypt를 쓰므로 **Node 인스턴스에만** 둔다.
    // auth.config.ts(Edge)에 넣으면 proxy.ts를 통해 Edge 런타임에 유입돼 미들웨어가 깨진다.
    Credentials({
      id: 'credentials',
      name: 'email',
      credentials: {
        email: { label: '이메일', type: 'email' },
        password: { label: '비밀번호', type: 'password' },
      },
      async authorize(raw) {
        const email = normalizeEmail(typeof raw?.email === 'string' ? raw.email : '');
        const password = typeof raw?.password === 'string' ? raw.password : '';
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, passwordHash: true },
        });

        // 소셜로만 만든 계정(passwordHash null)도 여기서 null로 수렴 —
        // "비밀번호가 없는 계정"이라는 사실 자체를 응답으로 흘리지 않는다.
        if (!user?.passwordHash) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /**
     * token.sub를 **signIn이 upsert한 User.id와 같은 값**으로 고정한다.
     *
     * 이게 없으면 Auth.js가 발급한 내부 id(랜덤 UUID)가 token.sub에 실릴 수 있고, 그러면
     * 세션 userId와 DB User.id가 어긋난다. 증상은 조용하다 — 로그인은 되고 읽기는 시드 폴백이
     * 받아주므로 화면은 멀쩡한데, 쓰기만 FK 위반으로 죽는다(2026-07-28 실측).
     *
     * 규약: 구글 = providerAccountId(google sub) / 자체 가입 = User.id(cuid).
     * 최초 로그인 때만 account가 실려 오므로 그 시점에 한 번 심고 이후에는 유지한다.
     */
    async jwt({ token, user, account }) {
      const domainId = account?.providerAccountId ?? user?.id;
      if (domainId) token.sub = domainId;
      return token;
    },
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
