'use client';

// 로그인 진입 — 한 화면에 한 가지 행동만.
//
// 예전에는 로그인/가입 탭을 사용자가 먼저 골라야 했다. 그런데 "내가 이 서비스에 가입했던가"는
// 사용자가 기억할 일이 아니라 우리가 아는 사실이다. 그래서 탭을 없애고 이메일부터 받는다:
//   (0) 구글로 시작하기 — 실 Google OAuth(최소 scope). 언제나 한 번에 끝나는 문.
//   (1) 이메일 입력 → 계속  (여기까지가 첫 화면의 전부)
//   (2) 서버가 가입 여부를 판정 → 기존이면 "비밀번호 입력", 처음이면 "비밀번호 만들기"
// 어느 쪽이든 첫 진입 시 빈 진단 화면에서 시작한다(08-18에 데모 데이터 프로비저닝 제거).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

/**
 * 이메일을 낸 뒤의 화면 상태.
 * - signin: 가입된 이메일 → 비밀번호 입력
 * - signup: 처음 온 이메일 → 비밀번호 만들기
 * - google-only: 구글로만 만든 계정 → 비밀번호가 없으니 묻지 않고 구글 버튼으로 보낸다.
 *   비밀번호 칸을 그냥 보여주면 사용자는 "맞는 비밀번호"를 영원히 못 넣는다.
 */
type Step = { name: 'email' } | { name: 'password'; mode: 'signin' | 'signup' } | { name: 'google-only' };

export default function LoginPage() {
  const [pending, setPending] = useState<'google' | 'check' | 'submit' | null>(null);
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const copy = demo.login;
  const busy = pending !== null;

  // 비밀번호 단계로 넘어오면 커서를 바로 그 칸에 둔다 — 다음 행동이 하나뿐이므로
  // 클릭 한 번을 더 시킬 이유가 없다.
  useEffect(() => {
    if (step.name === 'password') passwordRef.current?.focus();
  }, [step.name]);

  function startGoogle() {
    setPending('google');
    // 콜백 성공 후 /after-login이 착지점을 정한다 — 계정이 없으면 온보딩, 있으면 대시보드.
    void signIn('google', { redirectTo: '/after-login' });
  }

  /** 1단계: 이메일만 받고, 로그인인지 가입인지는 서버가 판정한다. */
  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setPending('check');
    try {
      const res = await fetch('/api/register/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { exists: boolean; hasPassword: boolean };
        error?: string;
      };
      if (!json.ok || !json.data) {
        setError(json.error ?? '확인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      if (!json.data.exists) setStep({ name: 'password', mode: 'signup' });
      else if (json.data.hasPassword) setStep({ name: 'password', mode: 'signin' });
      else setStep({ name: 'google-only' });
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPending(null);
    }
  }

  /** 처음 화면으로. 이메일은 남겨 둔다 — 오타 교정이 목적이지 처음부터 다시가 아니다. */
  function backToEmail() {
    setStep({ name: 'email' });
    setPassword('');
    setError(null);
  }

  /** 2단계: 판정에 따라 로그인 또는 가입+로그인. */
  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy || step.name !== 'password') return;
    setError(null);
    setPending('submit');

    try {
      if (step.mode === 'signup') {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
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
          step.mode === 'signup'
            ? '가입은 됐지만 로그인에 실패했습니다. 다시 로그인해 주세요.'
            : '비밀번호가 맞지 않습니다.',
        );
        setPending(null);
        return;
      }

      // 성공 — 구글 경로와 동일하게 /after-login이 착지점을 정한다.
      window.location.href = '/after-login';
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
          {step.name === 'email' && (
            <>
              {/* 구글이 맨 위 — 가장 짧은 문이고, 이메일 경로와 겹치지 않는다. */}
              <button
                type="button"
                className="btn btn-google lg"
                onClick={startGoogle}
                disabled={busy}
              >
                <GoogleG />
                {copy.google}
              </button>
              <p className="auth-eyebrow">{copy.eyebrow}</p>

              <div className="auth-divider">
                <span>{copy.divider}</span>
              </div>

              <form className="auth-form" onSubmit={submitEmail}>
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

                {error && (
                  <p className="status danger" role="alert">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn btn-primary lg" disabled={busy}>
                  {pending === 'check' ? copy.pending : copy.continueEmail}
                </button>
              </form>
            </>
          )}

          {step.name === 'password' && (
            <form className="auth-form" onSubmit={submitPassword}>
              {/* 무엇에 대한 비밀번호인지 화면이 말해 준다. 뒤로 가는 길은 작게 —
                  주 행동은 어디까지나 아래 버튼 하나다. */}
              <p className="auth-step-email">
                <strong>{email}</strong>
                <button type="button" className="linklike" onClick={backToEmail} disabled={busy}>
                  {copy.back}
                </button>
              </p>
              <p className="advice" role="status">
                {step.mode === 'signup' ? copy.passwordTitleNew : copy.passwordTitleKnown}
              </p>

              <label className="auth-field">
                <span>{copy.passwordLabel}</span>
                <input
                  ref={passwordRef}
                  className="text-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={step.mode === 'signup' ? copy.passwordHint : copy.passwordPlaceholder}
                  autoComplete={step.mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={step.mode === 'signup' ? 10 : undefined}
                  disabled={busy}
                />
              </label>

              {error && (
                <p className="status danger" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn-primary lg" disabled={busy}>
                {pending === 'submit'
                  ? copy.pending
                  : step.mode === 'signup'
                    ? copy.submitSignup
                    : copy.submitSignin}
              </button>
            </form>
          )}

          {step.name === 'google-only' && (
            <div className="auth-form">
              <p className="auth-step-email">
                <strong>{email}</strong>
                <button type="button" className="linklike" onClick={backToEmail} disabled={busy}>
                  {copy.back}
                </button>
              </p>
              {/* 비밀번호가 없는 계정에 비밀번호를 물으면 영원히 못 들어온다. 문이 하나뿐임을 말해 준다. */}
              <p className="advice" role="status">
                {copy.googleOnly}
              </p>
              <button
                type="button"
                className="btn btn-google lg"
                onClick={startGoogle}
                disabled={busy}
              >
                <GoogleG />
                {copy.google}
              </button>
            </div>
          )}
        </div>

        <p className="auth-disclaimer">{copy.disclaimer}</p>

        {/* 가입 전에 무엇이 수집되는지 읽을 수 있어야 한다. 세로 569px 접힘(2026-08-03)을
            건드리지 않도록 한 줄·작은 글자로만 붙인다. */}
        <p className="auth-legal">
          <Link href="/privacy">개인정보처리방침</Link>
          <span aria-hidden="true">·</span>
          <Link href="/terms">이용약관</Link>
        </p>
      </div>
    </div>
  );
}
