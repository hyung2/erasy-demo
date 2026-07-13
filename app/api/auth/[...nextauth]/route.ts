// Auth.js 라우트 핸들러 — next-auth v5 handlers 재노출(GET/POST).
// 실제 OAuth 콜백 처리는 W2에서 env·리다이렉트 URI 등록 후 활성.
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
