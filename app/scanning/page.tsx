'use client';

// 스캔 연출(전체화면). 단계 프로그레스 → 완료 후 자동 전환.
// 기본은 /dashboard(로그인 최초 흐름). ?return=/scan 이면 /scan 복귀(스캔 화면 "다시 스캔" 왕복).
// 실제 조회 없음 — 데이터는 예시. 타이밍만 연출. 디자이너 다크 톤 차용.
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { brand, demo } from '@/content/copy';
import { accounts } from '@/lib/dummy-data';

const STEP_MS = 750;

// 오픈 리다이렉트 방지 — 앱 내부 경로만 허용.
const ALLOWED_RETURN = new Set(['/dashboard', '/scan']);

function ScanningInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('return');
  const returnTo = raw && ALLOWED_RETURN.has(raw) ? raw : '/dashboard';

  const steps = demo.scanning.steps;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= steps.length) {
      const t = setTimeout(() => router.replace(returnTo), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [step, steps.length, router, returnTo]);

  const done = step >= steps.length;
  const progress = done ? 100 : Math.round((step / steps.length) * 100);
  const doneMsg = returnTo === '/scan' ? '스캔 완료 · 계정 목록으로 돌아갑니다' : demo.scanning.done;

  return (
    <div className="erasy-landing erasy-auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="logo">{brand.nameEn}</span>
        </div>

        <span className="auth-notice">{demo.scanning.badge}</span>

        <div className="auth-head">
          <h1>{done ? doneMsg : demo.scanning.title}</h1>
          <p>{demo.scanning.subtitle}</p>
        </div>

        <div className="panel auth-card">
          <div className="progress-track" role="img" aria-label={`스캔 진행률 ${progress}%`}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <ul className="scan-steps">
            {steps.map((label, i) => {
              const state = done || i < step ? 'done' : i === step ? 'active' : 'idle';
              return (
                <li key={label} className={state === 'done' ? 'is-done' : state === 'active' ? 'is-active' : ''}>
                  <span>{label}</span>
                  <span className="s-state">
                    {state === 'done' ? '완료' : state === 'active' ? '확인 중…' : '대기'}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="auth-eyebrow">확인된 계정 {accounts.length}개 · 안전도 점수를 산출하고 있습니다.</p>
        </div>
      </div>
    </div>
  );
}

export default function ScanningPage() {
  return (
    <Suspense fallback={null}>
      <ScanningInner />
    </Suspense>
  );
}
