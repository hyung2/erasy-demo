'use client';

// 로그인 직후 온보딩 — **한 곳씩 순서대로** 찾는다.
//
// 처음에는 이 화면이 연출이었다. 프로그레스가 3.7초 돌고 대시보드로 넘어갔고 조회는 하나도
// 하지 않았다(2026-08-18에 실제 스캔으로 교체).
//
// 그다음에는 두 경로(메일함·연결목록)를 한 화면에 나란히 놨다. 그런데 연결목록은 제공사가
// 셋이고 각각 다른 곳을 봐야 한다 — 한 화면에 칩으로 몰아 두니 "지금 어디까지 했는지"가
// 사용자에게 남지 않았다. 실제로 카카오만 하고 끝난 줄 아는 일이 생겼다(2026-08-20).
//
// 그래서 제공사별로 단계를 나눈다. 한 화면에 할 일 하나, 끝나면 다음. 각 단계는 건너뛸 수
// 있고, 마지막에 종합 목록으로 간다. 무엇을 했고 무엇을 건너뛰었는지가 진행 표시에 남는다.
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GmailScan from '@/components/GmailScan';
import ConnectionImport from '@/components/ConnectionImport';
import { brand } from '@/content/copy';
import type { ImportProvider } from '@/lib/connection-import';

// 오픈 리다이렉트 방지 — 앱 내부 경로만 허용.
const ALLOWED_RETURN = new Set(['/dashboard', '/scan']);

type StepId = ImportProvider | 'mail';

const STEPS: {
  id: StepId;
  label: string;
  title: string;
  guide: string;
}[] = [
  {
    id: 'google',
    label: '구글',
    title: '구글로 가입한 서비스부터 찾을게요',
    guide:
      '구글 계정에 연결된 서비스 목록입니다. 플랫폼이 준 사실이라 추측이 섞이지 않습니다.',
  },
  {
    id: 'kakao',
    label: '카카오',
    title: '카카오로 가입한 서비스를 찾을게요',
    guide:
      '카카오는 카카오서비스·제휴·외부 세 갈래로 나뉘어 있어, 세 곳을 모두 확인합니다.',
  },
  {
    id: 'naver',
    label: '네이버',
    title: '네이버로 가입한 서비스를 찾을게요',
    guide: '네이버 아이디로 로그인한 서비스 목록입니다.',
  },
  {
    id: 'mail',
    label: '메일함',
    title: '메일함에도 가입 흔적이 남아 있어요',
    guide:
      '가입·인증 메일이 남아 있는 서비스를 찾습니다. 메일 본문은 읽지 않고 보낸 사람만 봅니다.',
  },
];

function ScanningInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('return');
  // 수집이 끝나면 **점수부터** 보여준다. 계정 목록으로 착지하면 사용자는 긴 목록 앞에서
  // 무엇을 해야 할지 스스로 정해야 하는데, 방금 계정을 찾아 준 직후에 할 말은
  // "당신 상태가 몇 점입니다"이고 그다음이 "그래서 무엇부터 하면 됩니다"다.
  // 대시보드는 점수와 추천 액션을 그 순서로 갖고 있다.
  const returnTo = raw && ALLOWED_RETURN.has(raw) ? raw : '/dashboard';

  const [index, setIndex] = useState(0);
  /** 각 단계에서 실제로 뭔가 담았는지. 건너뛴 것과 구분해 마지막 화면이 사실대로 말한다. */
  const [applied, setApplied] = useState<Record<string, boolean>>({});

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const doneCount = useMemo(() => Object.values(applied).filter(Boolean).length, [applied]);

  function goNext() {
    if (isLast) router.replace(returnTo);
    else setIndex((i) => i + 1);
  }

  return (
    <div className="erasy-landing erasy-auth is-onboarding">
      <div className="auth-box onboard-box">
        <div className="auth-brand">
          <span className="logo">{brand.nameEn}</span>
        </div>

        {/* 진행 표시 — 막대로 어디쯤인지, 라벨로 무엇이 끝났는지.
            건너뛴 단계는 완료로 세지 않는다(막대는 위치, 체크는 실제 성과). */}
        <div
          className="onboard-bar"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
          aria-label={`계정 찾기 ${index + 1}/${STEPS.length}단계`}
        >
          <div className="onboard-bar-track">
            <i style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>
          <div className="onboard-bar-steps">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={
                  applied[s.id] ? 'is-done' : i === index ? 'is-current' : i < index ? 'is-past' : ''
                }
              >
                {applied[s.id] ? '✓' : i + 1} {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="auth-head compact">
          <h1>{step.title}</h1>
          <p>{step.guide}</p>
        </div>

        {step.id === 'mail' ? (
          <GmailScan compact onApplied={() => setApplied((p) => ({ ...p, mail: true }))} />
        ) : (
          <ConnectionImport
            key={step.id}
            lockedProvider={step.id}
            onApplied={() => setApplied((p) => ({ ...p, [step.id]: true }))}
            onNext={goNext}
            nextLabel={
              isLast ? '찾은 계정 모두 보기' : `다음 · ${STEPS[index + 1].label} 찾기`
            }
          />
        )}

        <div className="onboard-actions">
          <button
            type="button"
            className={applied[step.id] ? 'btn btn-primary' : 'btn'}
            onClick={goNext}
          >
            {isLast
              ? doneCount > 0
                ? '내 안전도 점수 보기'
                : '건너뛰고 둘러보기'
              : applied[step.id]
                ? `다음 · ${STEPS[index + 1].label}`
                : `${STEPS[index + 1].label} 먼저 하기`}
          </button>
          {!isLast && (
            <button
              type="button"
              className="linklike"
              onClick={() => router.replace(returnTo)}
            >
              나중에 하고 점수 보기
            </button>
          )}
        </div>

        <p className="auth-eyebrow">
          {doneCount === 0
            ? '한 곳만 해도 됩니다. 나중에 계정 목록에서 이어서 할 수 있어요.'
            : `${doneCount}곳에서 찾았어요. 남은 단계를 마치면 빠지는 계정이 줄어듭니다.`}
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
