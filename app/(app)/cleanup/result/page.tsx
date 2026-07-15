'use client';

// 정리 결과 Before/After — 데모 클라이맥스(T5.4b). 회복 투영(순수 엔진)으로 종합·4축 상승 시각화.
// 정직 가드: "예상 도달" 라벨. "표면 제거"는 방치(surface) 축에만 — 유출 무효화 과장 금지.
import { useMemo } from 'react';
import Link from 'next/link';
import { CountUp } from '@/components/CountUp';
import { projectRecovery } from '@/lib/score-projection';
import { targetScore } from '@/lib/dummy-data';
import { demo } from '@/content/copy';
import type { AxisKey } from '@/lib/score-v2';

// 축 표시 메타 + 회복 라벨(과장 금지 — surface만 "표면 제거").
const AXIS_META: Record<AxisKey, { label: string; recover: string }> = {
  exposure: { label: '유출 노출', recover: '유출 항목 조치' },
  surface: { label: '방치 표면', recover: '방치 표면 제거' },
  hygiene: { label: '계정 위생', recover: '비밀번호 위생 개선' },
  threat: { label: '진행형 위협', recover: '이상 세션 정리' },
};

const band = (s: number) => (s >= 80 ? 'is-safe' : s >= 50 ? 'is-warn' : 'is-danger');

export default function CleanupResultPage() {
  const proj = useMemo(() => projectRecovery(), []);
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
                  <span className="axis-delta-label">{meta.label}</span>
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
