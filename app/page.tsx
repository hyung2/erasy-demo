'use client';

// 로그인 진입. "구글로 시작하기" → 실 Google OAuth(Auth.js v5, 최소 scope) → 콜백 후 /scanning → /dashboard.
// 실 인증 배선(T2.1). 실동작은 env 시크릿 도착 후 검증. Google 계정 선택은 Google 자체 화면이 담당(기존 가짜 피커 제거).
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { brand, demo } from '@/content/copy';

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const [pending, setPending] = useState(false);

  function startLogin() {
    setPending(true);
    // 콜백 성공 후 /scanning으로 복귀(스캔 연출 → /dashboard). signIn이 페이지를 이탈시킨다.
    void signIn('google', { redirectTo: '/scanning' });
  }

  return (
    <div className="erasy-landing erasy-auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="logo">{brand.nameEn}</span>
        </div>

        <span className="auth-notice">{demo.login.notice}</span>

        <div className="auth-head">
          <h1>{demo.login.headline}</h1>
          <p>{demo.login.subhead}</p>
        </div>

        <div className="panel auth-card">
          <button
            type="button"
            className="btn btn-google lg"
            onClick={startLogin}
            disabled={pending}
          >
            <GoogleG />
            {demo.login.google}
          </button>
          <p className="auth-eyebrow">{demo.login.eyebrow}</p>
        </div>

        <p className="auth-disclaimer">{demo.login.disclaimer}</p>
      </div>
    </div>
  );
}
