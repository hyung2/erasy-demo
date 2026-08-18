'use client';

// 로그인 직후 온보딩. **실제 스캔을 여기서 시작한다.**
//
// 예전에는 이 화면이 연출이었다 — 프로그레스가 3초 돌고 대시보드로 넘어갔고, 조회는
// 하나도 하지 않았다. 시드 24계정이 깔려 있던 동안에는 그럴듯해 보였지만, 신규 사용자가
// 빈 상태로 시작하게 되면서 "스캔했다더니 아무것도 없다"가 됐다(2026-08-18).
// 심사위원이 각자 계정으로 로그인해 보는 경로라, 첫 화면이 거짓말을 하면 안 된다.
//
// ?return=/scan 이면 완료 후 계정 목록으로 돌아간다(스캔 화면의 "다시 스캔" 왕복).
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GmailScan from '@/components/GmailScan';
import { brand, demo } from '@/content/copy';

// 오픈 리다이렉트 방지 — 앱 내부 경로만 허용.
const ALLOWED_RETURN = new Set(['/dashboard', '/scan']);

function ScanningInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('return');
  const returnTo = raw && ALLOWED_RETURN.has(raw) ? raw : '/dashboard';

  // 스캔이 한 번이라도 반영되면 다음 걸음을 "찾은 계정 보러 가기"로 바꾼다.
  const [applied, setApplied] = useState(false);

  return (
    <div className="erasy-landing erasy-auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="logo">{brand.nameEn}</span>
        </div>

        <div className="auth-head">
          <h1>{demo.scanning.title}</h1>
          <p>{demo.scanning.subtitle}</p>
        </div>

        {/* 실제 스캔 컴포넌트. 권한 동의·진행·결과·실패를 모두 이 안에서 사실대로 말한다. */}
        <GmailScan onApplied={() => setApplied(true)} />

        {/* 메일 스캔이 유일한 입구가 되면, 구글 권한 창을 넘지 못한 사람은 제품을 아예
            못 본다. 다른 경로를 같은 자리에 두어 어디로든 시작할 수 있게 한다. */}
        <div className="onboard-actions">
          <button
            type="button"
            className={applied ? 'btn btn-primary' : 'btn'}
            onClick={() => router.replace(applied ? '/scan' : returnTo)}
          >
            {applied ? demo.scanning.goInventory : demo.scanning.skip}
          </button>
          {!applied && (
            <button
              type="button"
              className="btn"
              onClick={() => router.replace('/scan#connection-import')}
            >
              다른 방법으로 채우기
            </button>
          )}
        </div>

        <p className="auth-eyebrow">
          메일함을 쓰지 않아도 됩니다. 소셜 로그인 연결목록을 붙여넣거나, 아는 계정을 직접
          추가해서 시작할 수 있어요.
        </p>
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
