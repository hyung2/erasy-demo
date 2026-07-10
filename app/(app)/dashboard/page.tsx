'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDemo } from '@/components/DemoStateClient';
import { CountUp } from '@/components/CountUp';
import { ScoreBenchmarkChart } from '@/components/ScoreBenchmarkChart';
import { demo } from '@/content/copy';
import {
  accounts,
  privacyScore,
  privacyGrade,
  deriveGrade,
  scoreDelta,
  targetScore,
  breachedCount,
  cleanupCount,
  overseasCount,
  socialCount,
  unusedCount,
  activityFeed,
  monthlyLabels,
  myMonthlyTrend,
  peerMonthlyAvg,
  highRiskCount,
  type FeedItem,
} from '@/lib/dummy-data';

const pct = (n: number) => Math.round((n / accounts.length) * 100);

const dotClass: Record<FeedItem['tone'], string> = {
  error: 'is-danger',
  warning: 'is-warn',
  success: 'is-safe',
  neutral: 'is-safe',
};

const RISK_ALERT_KEY = 'erasy-risk-alerted';

const NEXT_ACTIONS = [
  { label: '계정 스캔하기', href: '/scan', desc: '흩어진 계정을 다시 훑어봅니다.' },
  { label: '침해 알림 확인', href: '/breach', desc: '유출된 계정을 점검합니다.' },
  { label: '연결앱 정리', href: '/cleanup', desc: '안 쓰는 연결을 끊습니다.' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [guideOpen, setGuideOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const { cleaned } = useDemo();

  // 정리 완료 시 안전도 62→85(연출). 등급·델타·게이지 색도 함께.
  const score = cleaned ? targetScore : privacyScore;
  const grade = cleaned ? deriveGrade(score) : privacyGrade;
  const delta = cleaned ? targetScore - privacyScore : scoreDelta;

  const scoreClass = grade === '위험' ? ' is-danger' : grade === '주의' ? ' is-warn' : '';
  const gaugeClass = grade === '양호' ? ' is-safe' : grade === '주의' ? ' is-warn' : ' is-danger';
  const badgeClass = grade === '양호' ? 'badge live' : 'badge warn-badge';

  // 월별 벤치마크: 내 라인 마지막 = 현재 점수. 또래 평균과 위치 비교.
  const myLine = [...myMonthlyTrend.slice(0, -1), score];
  const peerLast = peerMonthlyAvg[peerMonthlyAvg.length - 1];
  const posLabel =
    score < peerLast - 2 ? demo.benchmark.below : score > peerLast + 2 ? demo.benchmark.above : demo.benchmark.about;
  const posBadge = score > peerLast + 2 ? 'badge live' : score < peerLast - 2 ? 'badge warn-badge' : 'badge';

  const bars = [
    { key: '소셜 로그인', dot: 'is-accent', cls: '', count: socialCount },
    { key: '해외 서비스', dot: 'is-caution', cls: ' is-caution', count: overseasCount },
    { key: '미사용 12개월+', dot: 'is-warn', cls: ' is-warn', count: unusedCount },
  ];

  // 로그인 후 3.7초 위험 알림 모달: 정리 전(위험 있음)에만·흐름당 1회.
  useEffect(() => {
    if (cleaned) return;
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(RISK_ALERT_KEY) === '1') return;
    const t = setTimeout(() => {
      setRiskOpen(true);
      sessionStorage.setItem(RISK_ALERT_KEY, '1');
    }, 3700);
    return () => clearTimeout(t);
  }, [cleaned]);

  function goScan() {
    setRiskOpen(false);
    router.push('/scan');
  }

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>대시보드</h1>
        </div>
        <div className="head-right">
          <span className="head-meta">
            마지막 스캔 <time dateTime="2026-07-08">어제 21:04</time>
          </span>
          <Link href="/scan" className="btn btn-primary compact">
            다시 스캔
          </Link>
        </div>
      </div>

      {/* 프라이버시 점수 */}
      <section className="panel score-panel" aria-label="프라이버시 점수">
        <div className="score-figure">
          <div className={`score-big${scoreClass}`}>
            <CountUp value={score} />
            <small>/ 100</small>
          </div>
          <span className={badgeClass}>등급 {grade}</span>
        </div>

        <div className="score-meta">
          <p className="score-up">
            ▲ {delta} <span>지난주 대비</span>
          </p>
          <p className="score-sub">
            프라이버시 점수가 오르고 있어요. 남은 위험을 정리하면 더 안전해집니다.
          </p>
          <div
            className={`bar score-gauge${gaugeClass}`}
            role="img"
            aria-label={`100점 만점에 ${score}점`}
          >
            <i style={{ width: `${score}%` }} />
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(true)}>
          점수 올리는 법
        </button>
      </section>

      {/* 추천 액션 — 점수 패널 바로 아래로 재배치 */}
      <h2 className="section-label">추천 액션</h2>
      <div className="action-grid">
        {NEXT_ACTIONS.map((a) => (
          <Link className="action-card" href={a.href} key={a.href}>
            <h4>{a.label}</h4>
            <p>{a.desc}</p>
            <span className="action-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>

      {/* 요약 통계 */}
      <h2 className="section-label">요약</h2>
      <div className="stat-grid">
        <div className="stat">
          <div className="lbl">연결 계정</div>
          <div className="num">
            <CountUp value={accounts.length} />
          </div>
          <div className="delta">지난주 대비 +2</div>
        </div>
        <div className="stat">
          <div className="lbl">유출 발견</div>
          <div className="num danger">
            <CountUp value={breachedCount} />
          </div>
          <div className="delta is-danger">이번 주 신규 1건</div>
        </div>
        <div className="stat">
          <div className="lbl">정리 대기</div>
          <div className="num warn">
            <CountUp value={cleanupCount} />
          </div>
          <div className="delta">12개월 이상 미사용</div>
        </div>
        <div className="stat">
          <div className="lbl">해외 서비스</div>
          <div className="num">
            <CountUp value={overseasCount} />
          </div>
          <div className="delta is-up">모두 점검 완료</div>
        </div>
      </div>

      <div className="two-col">
        {/* 위험 분포 */}
        <section className="panel">
          <div className="panel-head">
            <h3>위험 분포</h3>
            <span className="panel-note">전체 {accounts.length}개 계정</span>
          </div>
          {bars.map((b) => (
            <div className="bar-row" key={b.key}>
              <div className="bar-label">
                <span className="bar-key">
                  <i className={`dot ${b.dot}`} aria-hidden="true" />
                  {b.key}
                </span>
                <span className="bar-val">
                  {b.count}개 · {pct(b.count)}%
                </span>
              </div>
              <div className={`bar${b.cls}`}>
                <i style={{ width: `${pct(b.count)}%` }} />
              </div>
            </div>
          ))}
        </section>

        {/* 최근 활동 */}
        <section className="panel">
          <div className="panel-head">
            <h3>최근 활동</h3>
            <span className="panel-note">최근 7일</span>
          </div>
          <ul className="activity">
            {activityFeed.map((f) => (
              <li key={f.id}>
                <span className="act-text">
                  <i className={`dot ${dotClass[f.tone]}`} aria-hidden="true" />
                  {f.text}
                </span>
                <time>{f.when}</time>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* 월별 추이 + 또래 벤치마크 (4주 막대 → 교체) */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{demo.benchmark.title}</h3>
            <p className="panel-note">
              {demo.benchmark.sub} · {demo.benchmark.peerNote}
            </p>
          </div>
          <div className="bench-tags">
            <span className={posBadge}>{posLabel}</span>
            <span className="badge">{demo.benchmark.badge}</span>
          </div>
        </div>
        <ScoreBenchmarkChart
          labels={monthlyLabels}
          mine={myLine}
          peer={peerMonthlyAvg}
          meLabel={demo.benchmark.me}
          peerLabel={demo.benchmark.peer}
        />
      </section>

      {/* 점수 올리는 법 모달 */}
      {guideOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setGuideOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-score-title">
            <h3 id="modal-score-title">점수 올리는 법</h3>
            <ol>
              <li>유출된 계정의 비밀번호를 교체하세요.</li>
              <li>12개월 이상 안 쓴 소셜 연결을 정리하세요.</li>
              <li>2단계 인증(2FA)을 켤 수 있는 계정에 활성화하세요.</li>
            </ol>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 로그인 후 5초 위험 알림 모달(정리 전만·1회) */}
      {riskOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setRiskOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-risk-title">
            <div className="risk-modal-head">
              <h3 id="modal-risk-title">{demo.riskAlert.title}</h3>
              <span className="badge">{demo.riskAlert.badge}</span>
            </div>
            <p className="risk-modal-lead">
              <span className="alert-mark" aria-hidden="true" />
              <strong>
                {demo.riskAlert.bodyPrefix}
                {highRiskCount}
                {demo.riskAlert.bodySuffix}
              </strong>
            </p>
            <p>{demo.riskAlert.desc}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setRiskOpen(false)}>
                {demo.riskAlert.later}
              </button>
              <button type="button" className="btn btn-primary" onClick={goScan}>
                {demo.riskAlert.cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
