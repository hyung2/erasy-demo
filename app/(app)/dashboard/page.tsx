'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDemo } from '@/components/DemoStateClient';
import { CountUp } from '@/components/CountUp';
import { ScoreBenchmarkChart } from '@/components/ScoreBenchmarkChart';
import { HygieneQuickReport } from '@/components/HygieneQuickReport';
import { demo } from '@/content/copy';
import type { ScoreDTO, AccountDTO, CleanupQueueItemDTO, AlertDTO } from '@/lib/api-types';
import type { AxisKey, ActionType } from '@/lib/score-v2';
// peerMonthlyAvg만 남는다 — 또래 평균은 관측치가 아니라 예시 기준선이고, 화면이 "예시" 배지로
// 그 사실을 말한다. 활동 피드는 실데이터(/api/guard)로 옮겼다.
import { peerMonthlyAvg } from '@/lib/dummy-data';

// 요약·분포 수치는 **이 사용자의 실제 인벤토리**(/api/accounts)에서 파생한다.
// 이전에는 dummy-data의 모듈 상수(accounts.length·breachedCount·overseasCount…)를 그대로 렌더해
// 계정이 30개여도 화면은 늘 24라고 말했다. 점수만 실값이고 나머지가 시드라 scan 화면(27·30)과
// 숫자가 어긋났다(2026-08-04 실측). 로딩 전에는 시드 숫자로 때우지 않고 —로 비워 둔다.
const DORMANT_DAYS = 365; // "미사용 12개월+" 기준

type Inventory = {
  total: number;
  breached: number;
  overseas: number;
  social: number;
  unused: number;
  highRisk: number;
};

function summarize(list: AccountDTO[]): Inventory {
  return {
    total: list.length,
    breached: list.filter((a) => a.breached).length,
    overseas: list.filter((a) => a.category === 'overseas').length,
    social: list.filter((a) => a.category === 'social').length,
    unused: list.filter((a) => a.lastUsedDays >= DORMANT_DAYS).length,
    highRisk: list.filter((a) => a.risk === 'high').length,
  };
}

const dotClass: Record<AlertDTO['tone'], string> = {
  error: 'is-danger',
  warning: 'is-warn',
  success: 'is-safe',
  neutral: 'is-safe',
};

const RISK_ALERT_KEY = 'erasy-risk-alerted';

// 4축 표시 메타(한국어 축명). 점수 엔진 v2 AxisKey와 1:1. (E/S/H/T 배지는 라벨과 불일치·장식이라 제거)
const AXIS_META: Record<AxisKey, { label: string }> = {
  exposure: { label: '유출 위험 — 내 정보가 이미 새어나갔는지' },
  surface: { label: '방치된 계정 — 안 쓰고 오래 둔 계정' },
  hygiene: { label: '비밀번호 습관 — 재사용·2단계 인증 상태' },
  threat: { label: '이상 접속 — 지금 수상한 로그인이 있는지' },
};
const AXIS_ORDER: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];

// 회복 액션 표시 라벨 + 이동 경로(과장 금지 문구 — 무효화 표현 없음). href는 내부 경로(불변).
const ACTION_META: Record<ActionType, { label: string; href: string }> = {
  password_change: { label: '유출된 비밀번호 바꾸기', href: '/breach' },
  resolve_breach: { label: '유출 계정 처리하기', href: '/breach' },
  enable_2fa: { label: '2단계 인증 켜기', href: '/breach' },
  delete: { label: '방치 계정 정리하기', href: '/cleanup' },
  revoke: { label: '소셜 연결 끊기', href: '/cleanup' },
  logout_sessions: { label: '이상 접속 끊기', href: '/cleanup' },
};

// 점수대 → 게이지 색 밴드(80+ 안전 / 50+ 주의 / 그 외 위험). deriveGrade 임계와 정합.
const band = (s: number) => (s >= 80 ? 'is-safe' : s >= 50 ? 'is-warn' : 'is-danger');

// 정적 폴백 네비(API 미준비·정리 완료 상태에서 노출).
const NEXT_ACTIONS = [
  { label: '계정 스캔하기', href: '/scan', desc: '흩어진 계정을 다시 훑어봅니다.' },
  { label: '유출 확인', href: '/breach', desc: '유출된 계정을 점검합니다.' },
  { label: '소셜 연결 정리', href: '/cleanup', desc: '안 쓰는 연결을 끊습니다.' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [guideOpen, setGuideOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const { cleaned } = useDemo();

  // 안전도 점수 v2 DTO — 종합·등급·델타·4축·최약축·기대상승을 API 실값으로 소비(하드코딩 금지).
  const [dto, setDto] = useState<ScoreDTO | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  // 인벤토리 실값 — 요약 카드·위험 분포의 근거. null이면 아직 모르는 상태이지 0이 아니다.
  const [inv, setInv] = useState<Inventory | null>(null);
  // 정리 목록에 담아 둔 건수. 헤드라인 점수는 건드리지 않고, "끝내면 몇 점"만 예정으로 알린다.
  const [pendingCleanup, setPendingCleanup] = useState(0);
  // 활동 피드 — 이 사용자에게 실제로 일어난 일만. 예전에는 dummy를 직접 import해서
  // 방금 가입한 사람도 "Quora 유출 정황 발견 · 2시간 전"을 자기 이력으로 봤다.
  const [feed, setFeed] = useState<AlertDTO[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/guard')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: { alerts: AlertDTO[] } }) => {
        if (alive) setFeed(body.data.alerts ?? []);
      })
      .catch(() => {
        if (alive) setFeed([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 자가신고를 반영한 뒤 점수·목록을 다시 읽기 위한 신호. 값이 바뀌면 두 조회가 다시 돈다.
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [reloadKey]);

  // 자가신고 빠른 입력이 원본 목록을 쓴다(요약만으로는 계정 id를 알 수 없다).
  const [accountList, setAccountList] = useState<AccountDTO[]>([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: AccountDTO[] }) => {
        // 실패해도 시드 상수로 되돌아가지 않는다 — 그 조용한 폴백이 숫자 불일치의 원인이었다.
        if (alive) {
          setInv(summarize(body.data ?? []));
          setAccountList(body.data ?? []);
        }
      })
      .catch(() => {
        if (alive) setInv(null);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch('/api/cleanup/requests')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: CleanupQueueItemDTO[] }) => {
        if (!alive) return;
        // 완료(done)는 이미 끝난 일이라 "예정"이 아니다.
        setPendingCleanup(
          (body.data ?? []).filter((q) => q.status === 'queued' || q.status === 'in_progress')
            .length,
        );
      })
      .catch(() => {
        // 못 가져오면 예정 줄을 띄우지 않는다(0 유지). 없는 건수를 지어내지 않는다.
        if (alive) setPendingCleanup(0);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 인벤토리 미확보 시 —. 0으로 때우면 "계정 없음"이라는 거짓 사실이 된다. */
  const n = (v: number | undefined) => (inv === null || v === undefined ? null : v);
  const pct = (v: number) => (inv === null || inv.total === 0 ? 0 : Math.round((v / inv.total) * 100));

  const apiScore = dto?.score ?? null;
  const apiGrade = dto?.grade ?? null;

  // 헤드라인은 **언제나 실측 점수**다.
  //   이전에는 정리 요청을 접수하면(`cleaned`) 회복 투영 도달점을 점수 자리에 띄웠다. 그런데
  //   접수는 "정리 목록에 담았다"는 뜻이지 정리를 끝냈다는 뜻이 아니다. 실제로는 아무 계정도
  //   해제·삭제되지 않았는데 헤드라인만 오르니, "정리 안 했는데 왜 올랐나"에 답할 수 없었다.
  //   08-04에 결과 화면이 시드로 24→93을 띄우던 것을 고친 것과 같은 문제다(도달점을 현재로 표기).
  //   도달점은 아래 "정리 예정" 줄에서 **예정**으로만 말한다.
  const score = apiScore ?? 0;
  const grade = apiGrade ?? '위험';
  const delta = dto?.delta ?? 0;
  // 담아 둔 정리를 끝냈을 때의 도달점. 큐가 비면 상승 여지가 없으므로 줄 자체를 숨긴다.
  const projectedScore = dto?.recovery?.afterComposite ?? null;
  const showProjection =
    pendingCleanup > 0 && projectedScore !== null && projectedScore > score;

  // 잴 계정이 하나도 없는 상태. 0점·"위험"으로 때우면 아무것도 모르는 것을 최악으로 단정하는
  // 셈이라, 점수 자리를 비우고 무엇을 하면 되는지만 말한다.
  const nothingToMeasure = loadState === 'ready' && inv !== null && inv.total === 0;

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

  // 추이 차트: 실제 측정 이력(ScoreSnapshot)만 그린다. 월별 더미 상수는 폐기 —
  //   앞 구간이 근거 없는 값이면 점수를 라벨로 찍는 순간 그대로 노출된다.
  //   2점 미만이면 선을 그리지 않고 안내 문구로 대체(가짜 추이 금지).
  const trendPoints = dto?.trendPoints ?? [];
  const hasTrendChart = trendPoints.length >= 2;
  const chartLabels = trendPoints.map((p) => {
    const d = new Date(p.at);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const chartMine = trendPoints.map((p) => p.score);
  // 또래 평균은 관측 데이터가 아니라 예시 기준선 — 점별 변동 없이 평평하게(배지 "예시" 유지).
  const peerLast = peerMonthlyAvg[peerMonthlyAvg.length - 1];
  const chartPeer = trendPoints.map(() => peerLast);
  const posLabel =
    score < peerLast - 2 ? demo.benchmark.below : score > peerLast + 2 ? demo.benchmark.above : demo.benchmark.about;
  const posBadge = score > peerLast + 2 ? 'badge live' : score < peerLast - 2 ? 'badge warn-badge' : 'badge';

  // ── GUARD "지속 관리" 카드 — 정리 후에도 지켜본다 서사(웨이브3). ──
  // 이번 주 변화: 스냅샷 이력 2건+ 있을 때만 delta, 1건이면 "관리 시작"(방어).
  const hasTrend = (dto?.trend?.length ?? 0) >= 2;
  const weekChange = hasTrend ? (delta >= 0 ? `+${delta}` : `${delta}`) : '관리 시작';
  const weekChangeCls = !hasTrend ? '' : delta > 0 ? ' up' : delta < 0 ? ' danger' : '';
  // 또래 대비 상위 백분위(데모 기준 근사 — 분포 상수 spread로 z→percentile). 평균 아래면 미표기.
  const aboveePeer = score >= peerLast;
  const topPct = Math.min(99, Math.max(1, Math.round(50 - ((score - peerLast) / 22) * 34)));

  const bars = [
    { key: '소셜 로그인', dot: 'is-accent', cls: '', count: inv?.social ?? 0 },
    { key: '해외 서비스', dot: 'is-caution', cls: ' is-caution', count: inv?.overseas ?? 0 },
    { key: '미사용 12개월+', dot: 'is-warn', cls: ' is-warn', count: inv?.unused ?? 0 },
  ];

  // 4축 진단·추천은 API가 준비된 경우 노출. 정리 요청을 접수했다고 숨기지 않는다 —
  //   담기는 조치가 아니므로 취약 축은 그대로 남아 있고, 화면이 그걸 감추면 안 된다.
  const showDiagnostics = loadState === 'ready' && dto !== null;
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
  // 위험이 0건이면 띄우지 않는다 — 계정을 아직 못 찾은 사람에게 "위험 계정 0개가
  // 발견됐어요"라고 말을 걸던 자리다(2026-08-18 실측).
  useEffect(() => {
    if (cleaned) return;
    if (!inv || inv.highRisk === 0) return;
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(RISK_ALERT_KEY) === '1') return;
    const t = setTimeout(() => {
      setRiskOpen(true);
      sessionStorage.setItem(RISK_ALERT_KEY, '1');
    }, 3700);
    return () => clearTimeout(t);
  }, [cleaned, inv]);

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
          <Link href="/scan" className="btn btn-primary compact">
            다시 스캔
          </Link>
        </div>
      </div>

      {/* 안전도 점수 */}
      <section className="panel score-panel" aria-label="안전도 점수">
        <div className="score-figure">
          <div className={`score-big${nothingToMeasure ? '' : scoreClass}`}>
            {loadState !== 'ready' || nothingToMeasure ? (
              <span aria-live="polite">—</span>
            ) : (
              <CountUp value={score} />
            )}
            <small>/ 100</small>
          </div>
          {!nothingToMeasure && <span className={badgeClass}>등급 {grade}</span>}
        </div>

        <div className="score-meta">
          {!nothingToMeasure && (
            <p className={deltaClass}>
              {deltaText} <span>직전 대비</span>
            </p>
          )}
          <p className="score-sub">
            {loadState === 'error'
              ? '점수를 불러오지 못했어요. 로그인 후 다시 시도해 주세요.'
              : nothingToMeasure
                ? '아직 찾은 계정이 없어 안전도를 낼 수 없어요. 메일함 스캔으로 시작해 보세요.'
                : scoreSub}
          </p>
          {/* 담아 둔 정리는 "예정"으로만 말한다. 접수했다고 점수가 오르지는 않는다. */}
          {showProjection && (
            <p className="score-sub score-pending">
              정리 예정 {pendingCleanup}건 · 끝내면 <strong>{projectedScore}점</strong>
            </p>
          )}
          {!nothingToMeasure && (
            <div
              className={`bar score-gauge${gaugeClass}`}
              role="img"
              aria-label={`100점 만점에 ${score}점`}
            >
              <i style={{ width: `${score}%` }} />
            </div>
          )}
        </div>

        {nothingToMeasure ? (
          /* 잴 것이 없는 사람에게 "점수 올리는 법"은 다음 걸음이 아니다. 찾는 것이 먼저다. */
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => router.push('/scanning')}
          >
            메일함에서 계정 찾기
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(true)}>
            점수 올리는 법
          </button>
        )}
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

      {/* 위생축이 꺼져 있으면 켜는 길을 바로 옆에 둔다.
          "근거 부족"이라고만 적어 두면 사용자는 무엇을 해야 그 축이 켜지는지 알 수 없고,
          우리는 비밀번호를 저장하지 않으므로 알려주지 않으면 영영 잴 수 없다. */}
      {dto && !dto.axes.hygiene.measured && accountList.length > 0 && (
        <HygieneQuickReport accounts={accountList} onDone={() => setReloadKey((k) => k + 1)} />
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
                    {count}개 계정에 적용돼요 · {AXIS_META[rec.axis].label.split(' — ')[0]} 점수가 오릅니다
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
        {/* 델타 문구도 파생값만 쓴다. "지난주 대비 +2"·"이번 주 신규 1건"·"모두 점검 완료"는
            근거 없는 고정 문자열이었다 — 데이터가 뭐든 같은 말을 했다. */}
        <div className="stat">
          <div className="lbl">연결 계정</div>
          <div className="num">{n(inv?.total) === null ? '—' : <CountUp value={inv!.total} />}</div>
          <div className="delta">{inv === null ? '불러오는 중' : `확인된 계정 ${inv.total}개 기준`}</div>
        </div>
        <div className="stat">
          <div className="lbl">유출 발견</div>
          <div className="num danger">
            {n(inv?.breached) === null ? '—' : <CountUp value={inv!.breached} />}
          </div>
          <div className={inv && inv.breached > 0 ? 'delta is-danger' : 'delta'}>
            {inv === null ? '불러오는 중' : inv.breached > 0 ? '미해결 유출' : '미해결 없음'}
          </div>
        </div>
        {/* 정리 대기 = **실제 정리 큐에 담긴 건수**. 이전에는 "6개월 이상 안 쓴 소셜 연결"을
            상한 7로 잘라 세던 시드 규칙이라, 20건을 담아도 카드는 6이라고 말했다. 한 화면 안에서
            같은 이름의 숫자가 둘로 갈리면 어느 쪽도 못 믿는다(2026-08-10). */}
        <div className="stat">
          <div className="lbl">정리 대기</div>
          <div className="num warn">
            <CountUp value={pendingCleanup} />
          </div>
          <div className="delta">
            {pendingCleanup > 0 ? '정리 목록에 담긴 계정' : '아직 담은 계정이 없어요'}
          </div>
        </div>
        <div className="stat">
          <div className="lbl">해외 서비스</div>
          <div className="num">
            {n(inv?.overseas) === null ? '—' : <CountUp value={inv!.overseas} />}
          </div>
          <div className="delta">{inv === null ? '불러오는 중' : `전체의 ${pct(inv.overseas)}%`}</div>
        </div>
      </div>

      <div className="two-col">
        {/* 위험 분포 */}
        <section className="panel">
          <div className="panel-head">
            <h3>위험 분포</h3>
            <span className="panel-note">
              {inv === null ? '계정 확인 중' : `전체 ${inv.total}개 계정`}
            </span>
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
          </div>
          {feed !== null && feed.length === 0 ? (
            <p className="panel-note">
              아직 기록된 활동이 없어요. 계정을 찾거나 정리를 담으면 여기에 쌓입니다.
            </p>
          ) : (
            <ul className="activity">
              {(feed ?? []).map((f) => (
                <li key={f.id}>
                  <span className="act-text">
                    <i className={`dot ${dotClass[f.tone]}`} aria-hidden="true" />
                    {f.message}
                  </span>
                  <time>{f.when}</time>
                </li>
              ))}
            </ul>
          )}
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
        {hasTrendChart ? (
          <ScoreBenchmarkChart
            labels={chartLabels}
            mine={chartMine}
            peer={chartPeer}
            meLabel={demo.benchmark.me}
            peerLabel={demo.benchmark.peer}
          />
        ) : (
          <p className="panel-note">{demo.benchmark.empty}</p>
        )}
      </section>

      {/* 지속 관리(GUARD) — 정리 후에도 지켜본다 */}
      <section className="panel" aria-label="지속 관리">
        <div className="panel-head">
          <div>
            <h3>지속 관리</h3>
            <p className="panel-note">정리 후에도 이레이지가 유출·이상 접속을 계속 지켜봅니다.</p>
          </div>
          <span className="badge">{demo.benchmark.badge}</span>
        </div>
        <div className="stat-grid cols3">
          <div className="stat">
            <div className="lbl">이번 주 점수 변화</div>
            <div className={`num${weekChangeCls}`}>{weekChange}</div>
            <div className="delta">{hasTrend ? '직전 스냅샷 대비' : '스냅샷이 쌓이면 추이를 보여드려요'}</div>
          </div>
          <div className="stat">
            <div className="lbl">또래 대비</div>
            <div className="num">{aboveePeer ? `상위 ${topPct}%` : '평균 아래'}</div>
            <div className="delta">30대 또래 · 데모 기준</div>
          </div>
          <div className="stat">
            <div className="lbl">다음 점검</div>
            <div className="num">7일 후</div>
            <div className="delta is-up">유출 DB·이상 접속 자동 점검</div>
          </div>
        </div>
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
              {/* "예시" 배지가 붙어 있었지만 이 수치는 실측(inv.highRisk)이다. 진짜를
                  예시라고 말하면 신뢰가 반대로 깎인다. */}
              <h3 id="modal-risk-title">{demo.riskAlert.title}</h3>
            </div>
            <p className="risk-modal-lead">
              <span className="alert-mark" aria-hidden="true" />
              <strong>
                {demo.riskAlert.bodyPrefix}
                {inv?.highRisk ?? 0}
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
