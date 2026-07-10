'use client';

// 로그인 진입(데모). "구글로 시작하기" → 계정 선택 연출 → /scanning.
// 정직 표기: 실제 구글 인증 아님. 실인증/백엔드 없음. 디자이너 다크 톤 차용.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [entering, setEntering] = useState(false);

  function choose() {
    setEntering(true);
    setPickerOpen(false);
    setTimeout(() => router.push('/scanning'), 450);
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
            onClick={() => setPickerOpen(true)}
            disabled={entering}
          >
            <GoogleG />
            {demo.login.google}
          </button>
          <p className="auth-eyebrow">{demo.login.eyebrow} · 실제 구글 인증이 아닙니다</p>
        </div>

        <p className="auth-disclaimer">{demo.login.disclaimer}</p>
      </div>

      {pickerOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="picker-title">
            <h3 id="picker-title">{demo.login.pickerTitle}</h3>
            <p>{demo.login.pickerNotice}</p>
            <div className="picker-list">
              {demo.login.accounts.map((a) => (
                <button type="button" className="picker-item" key={a.name} onClick={choose}>
                  <span className="avatar-sm">{a.name.slice(0, 1)}</span>
                  <span className="p-info">
                    <span className="p-name">{a.name}</span>
                    <span className="p-mail">{a.email || '다른 계정으로 계속'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
