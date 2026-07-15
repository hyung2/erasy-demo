'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDemo } from '@/components/DemoStateClient';
import { CountUp } from '@/components/CountUp';
import { ScoreBenchmarkChart } from '@/components/ScoreBenchmarkChart';
import { demo } from '@/content/copy';
import type { ScoreDTO } from '@/lib/api-types';
import type { AxisKey, ActionType } from '@/lib/score-v2';
import {
  accounts,
  deriveGrade,
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

// 4축 표시 메타(한국어 축명 + 축 문자). 점수 엔진 v2 AxisKey와 1:1.
const AXIS_META: Record<AxisKey, { label: string; letter: string }> = {
  exposure: { label: '유출 노출', letter: 'E' },
  surface: { label: '방치 표면', letter: 'S' },
  hygiene: { label: '계정 위생', letter: 'H' },
  threat: { label: '진행형 위협', letter: 'T' },
};
const AXIS_ORDER: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];

// 회복 액션 표시 라벨 + 이동 경로(과장 금지 문구 — "표면 제거"는 무효화 아님).
const ACTION_META: Record<ActionType, { label: string; href: string }> = {
  password_change: { label: '유출 비밀번호 교체', href: '/breach' },
  resolve_breach: { label: '유출 항목 조치', href: '/breach' },
  enable_2fa: { label: '2단계 인증 켜기', href: '/breach' },
  delete: { label: '방치 계정 정리', href: '/cleanup' },
  revoke: { label: '연결 해제', href: '/cleanup' },
  logout_sessions: { label: '이상 세션 로그아웃', href: '/cleanup' },
};

// 점수대 → 게이지 색 밴드(80+ 안전 / 50+ 주의 / 그 외 위험). deriveGrade 임계와 정합.
const band = (s: number) => (s >= 80 ? 'is-safe' : s >= 50 ? 'is-warn' : 'is-danger');

// 정적 폴백 네비(API 미준비·정리 완료 상태에서 노출).
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

  // 안전도 점수 v2 DTO — 종합·등급·델타·4축·최약축·기대상승을 API 실값으로 소비(하드코딩 금지).
  const [dto, setDto] = useState<ScoreDTO | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetch('/api/score')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: ScoreDTO }) => {
        if (alive) {
          setDto(body.data);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (alive) setLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const apiScore = dto?.score ?? null;
  const apiGrade = dto?.grade ?? null;

  // 정리 완료(데모) 시 목표 점수로 연출, 아니면 API 종합 점수. 등급·델타·게이지 색도 함께.
  const score = cleaned ? targetScore : (apiScore ?? 0);
  const grade = cleaned ? deriveGrade(score) : (apiGrade ?? '위험');
  const delta = cleaned ? targetScore - (apiScore ?? 0) : (dto?.delta ?? 0);

  const scoreClass = grade === '위험' ? ' is-danger' : grade === '주의' ? ' is-warn' : '';
  const gaugeClass = grade === '양호' ? ' is-safe' : grade === '주의' ? ' is-warn' : ' is-danger';
  const badgeClass = grade === '양호' ? 'badge live' : 'badge warn-badge';

  // 델타 표기(방어) — 상승/하락/변동없음. 스냅샷 1건이면 delta 0.
  const deltaText =
    delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : '변동 없음';
  const deltaClass = delta > 0 ? 'score-up' : delta < 0 ? 'score-up is-down' : 'score-up is-flat';

  // 등급별 헤드라인 서브 카피(정직 표기 — 위험 상태를 "오르는 중"으로 과장하지 않음).
  const scoreSub =
    grade === '양호'
      ? '안전한 상태예요. 남은 위험만 관리하면 됩니다.'
      : grade === '주의'
        ? '위험이 남아 있어요. 아래 진단에서 취약한 축부터 정리해 보세요.'
        : '지금 위험 신호가 있어요. 가장 취약한 축부터 조치하면 점수가 오릅니다.';

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

  // 4축 진단·추천은 정리 전(위험 남음)이며 API 준비된 경우만 노출.
  const showDiagnostics = !cleaned && loadState === 'ready' && dto !== null;
  const weakestAxis = dto?.weakestAxis ?? null;

  // 추천 액션: 기대 상승폭 내림차순, 최약축 액션 우선. 상위 3개만.
  const recommendations = dto
    ? [...dto.expectedGains]
        .sort((a, b) => {
          const wa = a.axis === weakestAxis ? 1 : 0;
          const wb = b.axis === weakestAxis ? 1 : 0;
          if (wa !== wb) return wb - wa;
          return b.expectedGain - a.expectedGain;
        })
        .slice(0, 3)
    : [];
  const showRecommendations = showDiagnostics && recommendations.length > 0;

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

      {/* 안전도 점수 */}
      <section className="panel score-panel" aria-label="안전도 점수">
        <div className="score-figure">
          <div className={`score-big${scoreClass}`}>
            {loadState !== 'ready' && !cleaned ? (
              <span aria-live="polite">—</span>
            ) : (
              <CountUp value={score} />
            )}
            <small>/ 100</small>
          </div>
          <span className={badgeClass}>등급 {grade}</span>
        </div>

        <div className="score-meta">
          <p className={deltaClass}>
            {deltaText} <span>직전 대비</span>
          </p>
          <p className="score-sub">
            {loadState === 'error' && !cleaned
              ? '점수를 불러오지 못했어요. 로그인 후 다시 시도해 주세요.'
              : scoreSub}
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

      {/* 4축 안전 진단(유출·방치·위생·위협) — 미측정 축은 정직하게 "확인 불가" */}
      {showDiagnostics && (
        <>
          <h2 className="section-label">안전 진단 · 4축</h2>
          <div className="stat-grid">
            {AXIS_ORDER.map((key) => {
              const a = dto!.axes[key];
              const meta = AXIS_META[key];
              const isWeakest = key === weakestAxis;
              const measured = a.measured && a.score !== null;
              const rounded = measured ? Math.round(a.score as number) : null;
              const cardCls = `stat axis-card${isWeakest ? ' is-weakest' : ''}`;
              return (
                <div className={cardCls} key={key}>
                  <div className="axis-top">
                    <span className="lbl">{meta.label}</span>
                    <span className="axis-letter">{meta.letter}</span>
                  </div>
                  {measured ? (
                    <div className={`num ${band(rounded as number) === 'is-danger' ? 'danger' : band(rounded as number) === 'is-warn' ? 'warn' : ''}`}>
                      {rounded}
                      <small style={{ fontSize: '0.8125rem', color: 'var(--text-mute)', fontWeight: 500 }}> / 100</small>
                    </div>
                  ) : (
                    <div className="num unmeasured">확인 불가</div>
                  )}
                  {measured ? (
                    <div className={`bar ${band(rounded as number)}`}>
                      <i style={{ width: `${rounded}%` }} />
                    </div>
                  ) : (
                    <div className="bar">
                      <i style={{ width: '0%' }} />
                    </div>
                  )}
                  <p className="axis-find">
                    {isWeakest && measured ? '가장 취약한 축 · ' : ''}
                    {measured
                      ? a.topFinding ?? '특이 위험 없음'
                      : `확인된 계정 ${a.coveredCount}/${a.totalCount} — 근거 부족`}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 추천 액션 — 기대 상승폭 기반(최약축 우선). 미준비 시 정적 네비 폴백 */}
      <h2 className="section-label">추천 액션</h2>
      <div className="action-grid">
        {showRecommendations
          ? recommendations.map((rec) => {
              const meta = ACTION_META[rec.actionType];
              const gain = Math.round(rec.expectedGain);
              const isPrimary = rec.axis === weakestAxis;
              const count = rec.accountIndices.length;
              return (
                <Link
                  className={`action-card${isPrimary ? ' is-primary' : ''}`}
                  href={meta.href}
                  key={rec.actionType}
                >
                  {isPrimary && <span className="action-flag">우선 조치</span>}
                  <h4>
                    {meta.label}
                    {gain > 0 && <span className="action-gain">+{gain}점</span>}
                  </h4>
                  <p>
                    대상 계정 {count}개 · {AXIS_META[rec.axis].label} 축이 회복됩니다.
                  </p>
                  <span className="action-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              );
            })
          : NEXT_ACTIONS.map((action) => (
              <Link className="action-card" href={action.href} key={action.href}>
                <h4>{action.label}</h4>
                <p>{action.desc}</p>
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
