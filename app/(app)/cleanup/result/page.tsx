'use client';

// 정리 결과 Before/After — 데모 클라이맥스(T5.4b). 회복 투영으로 종합·4축 상승 시각화.
// 정직 가드: "예상 도달" 라벨. "표면 제거"는 방치(surface) 축에만 — 유출 무효화 과장 금지.
//
// 투영은 **서버가 이 사용자의 실제 계정·정리 큐로 계산한 값**(GET /api/score의 recovery)을 쓴다.
// 이전에는 클라이언트가 `projectRecovery()`를 인자 없이 불러 시드로 계산했고, 그래서 계정을
// 몇 개 발견하든 항상 24→93이 떴다. 대시보드는 내려가는데 이 화면만 그대로여서 한 제품에
// 출발점이 두 개였다(2026-08-04 실측). 조회 실패 시 시드 숫자로 되돌아가지 않는다 —
// 그 조용한 폴백이 결함의 본체였다. 못 가져오면 못 가져왔다고 말한다.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CountUp } from '@/components/CountUp';
import { targetScore } from '@/lib/dummy-data';
import { demo } from '@/content/copy';
import type { ApiEnvelope, ScoreDTO, RecoveryProjectionDTO } from '@/lib/api-types';
import type { AxisKey } from '@/lib/score-v2';

// 축 표시 메타 + 회복 라벨(과장 금지 — 무효화 표현 없음). 라벨은 dashboard 4축과 동일.
const AXIS_META: Record<AxisKey, { label: string; recover: string }> = {
  exposure: { label: '유출 위험 — 내 정보가 이미 새어나갔는지', recover: '유출 항목 조치' },
  surface: { label: '방치된 계정 — 안 쓰고 오래 둔 계정', recover: '방치 계정 정리' },
  hygiene: { label: '비밀번호 습관 — 재사용·2단계 인증 상태', recover: '비밀번호 습관 개선' },
  threat: { label: '이상 접속 — 지금 수상한 로그인이 있는지', recover: '이상 세션 정리' },
};

const band = (s: number) => (s >= 80 ? 'is-safe' : s >= 50 ? 'is-warn' : 'is-danger');

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; proj: RecoveryProjectionDTO };

export default function CleanupResultPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/score', { cache: 'no-store' });
        if (!alive) return;
        if (!res.ok) {
          setState({
            phase: 'error',
            message:
              res.status === 401
                ? '세션이 만료됐습니다. 다시 로그인해 주세요.'
                : '결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        const body = (await res.json()) as ApiEnvelope<ScoreDTO>;
        if (!alive) return;
        const recovery = body.data?.recovery;
        if (!recovery) {
          // 서버가 투영을 안 내려줬는데 화면이 임의로 숫자를 만들면 그게 예전 결함이다.
          setState({ phase: 'error', message: '결과를 계산하지 못했습니다.' });
          return;
        }
        setState({ phase: 'ready', proj: recovery });
      } catch {
        if (alive) setState({ phase: 'error', message: '네트워크 오류가 발생했습니다.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.phase === 'loading') {
    return (
      <>
        <div className="page-head">
          <div className="head-left">
            <h1>정리 완료</h1>
          </div>
        </div>
        <section className="panel result-hero" aria-busy="true">
          <p className="result-lead">결과를 불러오는 중입니다…</p>
        </section>
      </>
    );
  }

  if (state.phase === 'error') {
    return (
      <>
        <div className="page-head">
          <div className="head-left">
            <h1>정리 완료</h1>
          </div>
        </div>
        <section className="panel result-hero">
          <p className="status danger" role="alert">
            {state.message}
          </p>
          <div className="result-actions">
            <Link href="/dashboard" className="btn btn-secondary">
              대시보드로
            </Link>
          </div>
        </section>
      </>
    );
  }

  const proj = state.proj;
  const before = proj.beforeComposite ?? 0;
  const after = proj.afterComposite ?? before;
  const goalLabel =
    after > targetScore ? '목표 초과 달성' : after === targetScore ? '목표 달성' : '다음 목표';

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>정리 완료</h1>
          <span className="badge">{demo.cleanup.riseNote}</span>
        </div>
      </div>

      {/* 종합 점수 상승 */}
      <section className="panel result-hero" aria-label="안전도 상승 결과">
        <p className="result-eyebrow">{demo.cleanup.riseLabel}</p>
        <div className="result-figure">
          <span className="result-before">{before}</span>
          <span className="result-arrow" aria-hidden="true">
            →
          </span>
          <span className="result-after">
            <CountUp value={after} />
            <small>/ 100</small>
          </span>
        </div>
        <p className="result-lead">{demo.cleanup.celebrate}</p>

        {/* 다음 목표 게이지 */}
        <div className="result-goal">
          <div className="result-goal-head">
            <span>{goalLabel}</span>
            <span className="result-goal-val">{targetScore}점</span>
          </div>
          <div className={`bar ${band(after)}`} role="img" aria-label={`현재 ${after}점, 목표 ${targetScore}점`}>
            <i style={{ width: `${Math.min(100, after)}%` }} />
          </div>
        </div>
      </section>

      {/* 축별 상승 */}
      <h2 className="section-label">무엇이 좋아졌나</h2>
      <div className="axis-delta-list panel">
        {proj.axisKeys.map((key) => {
          const b = proj.beforeAxes[key];
          const a = proj.afterAxes[key];
          const meta = AXIS_META[key];
          const measured = b.measured && a.measured && b.score !== null && a.score !== null;
          if (!measured) {
            return (
              <div className="axis-delta" key={key}>
                <div className="axis-delta-top">
                  <span className="axis-delta-label">{meta.label.split(' — ')[0]}</span>
                  <span className="axis-delta-unmeasured">확인 불가</span>
                </div>
                <div className="bar">
                  <i style={{ width: '0%' }} />
                </div>
              </div>
            );
          }
          const bv = Math.round(b.score as number);
          const av = Math.round(a.score as number);
          const delta = Math.max(0, av - bv);
          return (
            <div className="axis-delta" key={key}>
              <div className="axis-delta-top">
                <span className="axis-delta-label">{meta.label}</span>
                <span className="axis-delta-nums">
                  {bv} <span aria-hidden="true">→</span> <strong>{av}</strong>
                  {delta > 0 && <span className="axis-delta-gain">+{delta}</span>}
                </span>
              </div>
              <div className={`bar ${band(av)}`}>
                <i style={{ width: `${av}%` }} />
              </div>
              {delta > 0 && <p className="axis-delta-note">{meta.recover}</p>}
            </div>
          );
        })}
      </div>

      <div className="result-actions">
        <Link href="/dashboard" className="btn btn-secondary">
          대시보드로
        </Link>
        <Link href={demo.cleanup.afterCta.href} className="btn btn-primary">
          {demo.cleanup.afterCta.label}
        </Link>
      </div>

      <p className="result-disclaimer">
        예상 도달 시나리오입니다. 실제 점수는 조치 완료 후 재계산되어 반영됩니다.
      </p>
    </>
  );
}
