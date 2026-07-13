// next-auth 세션 타입 확장 — session.user.id(google sub 기준 안정 식별자) 노출.
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}
