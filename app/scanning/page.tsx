'use client';

// 로그인 직후 온보딩. **두 경로를 모두 밟게 한다.**
//
// 처음에는 이 화면이 연출이었다 — 프로그레스가 3.7초 돌고 대시보드로 넘어갔고 조회는 하나도
// 하지 않았다(2026-08-18에 실제 스캔으로 교체).
//
// 그다음 드러난 문제가 이것이다: 메일 스캔은 Gmail만 본다. 네이버·다음 메일을 주로 쓰는
// 사람은 스캔해도 거의 안 나오고, 빈 화면에서 시작해 빈 화면으로 끝난다. 한국 사용자에게는
// 오히려 소셜 로그인 연결목록 쪽이 더 많이 잡히는데(플랫폼이 준 사실이라 추정도 아니다),
// 그게 보조 버튼으로 밀려 있었다.
//
// 그래서 두 경로를 같은 무게로 세우고, 각각 끝냈는지를 화면이 기억한다. 어느 쪽을 먼저
// 하든 상관없고 둘 다 해야 빠지는 영역이 줄어든다.
//
// ?return=/scan 이면 완료 후 계정 목록으로 돌아간다(스캔 화면의 "다시 스캔" 왕복).
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GmailScan from '@/components/GmailScan';
import ConnectionImport from '@/components/ConnectionImport';
import { brand, demo } from '@/content/copy';

// 오픈 리다이렉트 방지 — 앱 내부 경로만 허용.
const ALLOWED_RETURN = new Set(['/dashboard', '/scan']);

function ScanningInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('return');
  const returnTo = raw && ALLOWED_RETURN.has(raw) ? raw : '/dashboard';

  // 두 경로의 완료 여부를 따로 기억한다. 하나만 하고 넘어가면 그 사실이 화면에 남는다.
  const [mailDone, setMailDone] = useState(false);
  const [linkDone, setLinkDone] = useState(false);
  const doneCount = Number(mailDone) + Number(linkDone);

  return (
    <div className="erasy-landing erasy-auth is-onboarding">
      <div className="auth-box onboard-box">
        <div className="auth-brand">
          <span className="logo">{brand.nameEn}</span>
        </div>

        <div className="auth-head">
          <h1>{demo.scanning.title}</h1>
          <p>{demo.scanning.subtitle}</p>
        </div>

        {/* 진행 표시 — 둘 다 해야 빠지는 곳이 줄어든다는 사실을 숫자로 보여준다. */}
        <div className="onboard-progress" role="status">
          <span className={linkDone ? 'is-done' : ''}>
            {linkDone ? '✓' : '1'} 소셜 연결목록 가져오기
          </span>
          <span className="sep" aria-hidden="true">·</span>
          <span className={mailDone ? 'is-done' : ''}>
            {mailDone ? '✓' : '2'} 메일함에서 찾기
          </span>
          <span className="onboard-progress-count">{doneCount}/2 완료</span>
        </div>

        <p className="onboard-guide">
          두 방법이 찾는 영역이 다릅니다. <strong>소셜 연결목록</strong>은 구글·카카오·네이버로
          간편가입한 서비스를 잡고, 플랫폼이 준 사실이라 추정이 없습니다.{' '}
          <strong>메일함</strong>은 가입·인증 메일이 남아 있는 서비스를 찾습니다.{' '}
          <strong>구글 메일을 주로 쓰지 않으신다면 1번이 훨씬 많이 찾습니다.</strong> 둘 다 하시면
          빠지는 영역이 줄어듭니다.
        </p>

        {/* 1 — 소셜 연결목록. 추가 권한이 필요 없고 플랫폼이 준 사실이라 추정이 아니다.
            사업계획서 "(다) 단계적 발견 경로"가 사용자 직접 가져오기를 1단계로, 메일 자동 분석을
            CASA 통과가 필요한 2단계로 못박았다. 화면 순서를 그 단계와 맞춘다. */}
        <ConnectionImport onApplied={() => setLinkDone(true)} />

        {/* 2 — 메일함. 민감 scope(gmail.readonly)라 "확인되지 않은 앱" 경고를 지나야 한다.
            첫 관문에 두면 들어오지도 못하고 돌아서는 사람이 생긴다. */}
        <GmailScan onApplied={() => setMailDone(true)} />

        <div className="onboard-actions">
          <button
            type="button"
            className={doneCount > 0 ? 'btn btn-primary' : 'btn'}
            onClick={() => router.replace(doneCount > 0 ? '/scan' : returnTo)}
          >
            {doneCount > 0 ? demo.scanning.goInventory : demo.scanning.skip}
          </button>
        </div>

        <p className="auth-eyebrow">
          {doneCount === 1
            ? '한 가지만 하셨어요. 나머지 하나도 하시면 못 찾은 계정이 더 나올 수 있습니다.'
            : '두 방법으로도 못 찾은 계정은 계정 목록에서 직접 추가할 수 있어요.'}
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
