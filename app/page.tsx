'use client';

// 로그인 진입. 두 경로가 같은 결과 상태로 착지한다.
//  (1) 구글로 시작하기 → 실 Google OAuth(Auth.js v5, 최소 scope)
//  (2) 이메일로 가입/로그인 → /api/register + credentials signIn
// 어느 쪽이든 첫 진입 시 본인 소유 데모 데이터 24계정이 프로비저닝된 뒤 /scanning → /dashboard.
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

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const [pending, setPending] = useState<'google' | 'email' | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const copy = demo.login;
  const busy = pending !== null;

  function startGoogle() {
    setPending('google');
    // 콜백 성공 후 /scanning으로 복귀(스캔 연출 → /dashboard). signIn이 페이지를 이탈시킨다.
    void signIn('google', { redirectTo: '/scanning' });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setPending('email');

    try {
      if (mode === 'signup') {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) {
          setError(json.error ?? '가입에 실패했습니다.');
          setPending(null);
          return;
        }
      }

      // 가입 직후에도 같은 자격으로 바로 로그인시킨다(가입→로그인 두 번 입력하는 마찰 제거).
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError(
          mode === 'signup'
            ? '가입은 됐지만 로그인에 실패했습니다. 다시 로그인해 주세요.'
            : '이메일 또는 비밀번호가 맞지 않습니다.',
        );
        setPending(null);
        return;
      }

      // 성공 — 구글 경로와 동일하게 스캔 연출을 거쳐 대시보드로.
      window.location.href = '/scanning';
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      setPending(null);
    }
  }

  return (
    <div className="erasy-landing erasy-auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="logo">{brand.nameEn}</span>
        </div>

        <span className="auth-notice">{copy.notice}</span>

        <div className="auth-head">
          <h1>{copy.headline}</h1>
          <p>{copy.subhead}</p>
        </div>

        <div className="panel auth-card">
          <div className="auth-tabs" role="tablist" aria-label="로그인 방식">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`auth-tab${mode === 'signin' ? ' is-active' : ''}`}
              onClick={() => switchMode('signin')}
              disabled={busy}
            >
              {copy.tabSignin}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab${mode === 'signup' ? ' is-active' : ''}`}
              onClick={() => switchMode('signup')}
              disabled={busy}
            >
              {copy.tabSignup}
            </button>
          </div>

          <form className="auth-form" onSubmit={submitEmail}>
            {mode === 'signup' && (
              <label className="auth-field">
                <span>{copy.nameLabel}</span>
                <input
                  className="text-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={copy.namePlaceholder}
                  autoComplete="name"
                  maxLength={50}
                  disabled={busy}
                />
              </label>
            )}

            <label className="auth-field">
              <span>{copy.emailLabel}</span>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={copy.emailPlaceholder}
                autoComplete="email"
                required
                disabled={busy}
              />
            </label>

            <label className="auth-field">
              <span>{copy.passwordLabel}</span>
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? copy.passwordHint : copy.passwordPlaceholder}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 10 : undefined}
                disabled={busy}
              />
            </label>

            {error && (
              <p className="status danger" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary lg" disabled={busy}>
              {pending === 'email'
                ? copy.pending
                : mode === 'signup'
                  ? copy.submitSignup
                  : copy.submitSignin}
            </button>
          </form>

          <div className="auth-divider">
            <span>{copy.divider}</span>
          </div>

          <button type="button" className="btn btn-google lg" onClick={startGoogle} disabled={busy}>
            <GoogleG />
            {copy.google}
          </button>
          <p className="auth-eyebrow">{copy.eyebrow}</p>
        </div>

        <p className="auth-disclaimer">{copy.disclaimer}</p>
      </div>
    </div>
  );
}
