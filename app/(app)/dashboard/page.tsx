'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDemo } from '@/components/DemoStateClient';
import { CountUp } from '@/components/CountUp';
import { ScoreBenchmarkChart } from '@/components/ScoreBenchmarkChart';
import { shouldAlertRisk } from '@/lib/risk-alert';
import { demo } from '@/content/copy';
import type {
  ScoreDTO,
  AccountDTO,
  CleanupQueueItemDTO,
  AlertDTO,
  GuardDTO,
} from '@/lib/api-types';
import { UNKNOWN_LAST_USED_DAYS } from '@/lib/api-types';
import type { AxisKey, ActionType } from '@/lib/score-v2';
// 측정 두께는 화면이 따로 세지 않는다 — 산식이 쓰는 그 함수·그 임계로 표기 수위를 정한다.
import { measuredWeight, SCORE_V2_PARAMS } from '@/lib/score-v2';
import { relativeTime } from '@/lib/activity';
// 자동 점검 주기·범위 정본. 화면이 자기 상수를 따로 갖지 않는다.
import {
  RESCAN_PERIOD_LABEL,
  RESCAN_SCOPE_LABEL,
  rescanTimeLabel,
} from '@/lib/rescan-schedule';
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
  overseas: number;
  social: number;
  unused: number;
  /** 마지막 사용 시각을 모르는 계정. 휴면이 아니라 **정보가 없는** 것이다. */
  unknownLastUsed: number;
  highRisk: number;
};

function summarize(list: AccountDTO[]): Inventory {
  return {
    total: list.length,
    // breached를 여기서 세지 않는다.
    //   Account.breached는 Breach 관계에서 파생되는 **캐시**이고, 유출 사건이 어느 계정
    //   것인지 특정하지 못하면(Breach.accountId = null) 켜지지 않는다. 그 상태에서 이 값을
    //   "유출 발견"으로 내보내면 축은 "미해결 유출 1건", 요약은 "미해결 없음"이라고 말하는
    //   화면이 된다(2026-08-24 실계정 실측). 유출 건수는 Breach 원본으로만 센다.
    overseas: list.filter((a) => a.category === 'overseas').length,
    social: list.filter((a) => a.category === 'social').length,
    // 미상을 휴면에 섞지 않는다.
    //   소셜 연결목록은 플랫폼이 사용일을 주지 않는다. 그걸 3650일로 세면 화면이
    //   "81%가 12개월 이상 미사용"이라고 말하는데, 그 81%는 관측이 아니라 우리가
    //   만들어 낸 값이다(2026-08-25 실측: 265개 중 205개가 미상).
    unused: list.filter(
      (a) => a.lastUsedDays >= DORMANT_DAYS && a.lastUsedDays < UNKNOWN_LAST_USED_DAYS,
    ).length,
    unknownLastUsed: list.filter((a) => a.lastUsedDays >= UNKNOWN_LAST_USED_DAYS).length,
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

/**
 * 화면에 세울 축을 고른다 — **넷 다 세운다.**
 *
 * 2026-08-21에는 비밀번호 습관 축을 미측정일 때 숨겼다. "잴 길이 없는 축을 카드로 세워
 * 두면 화면이 영구 미완성으로 보인다"는 이유였고, 잴 길이 정말 없었다면 옳았다.
 *
 * 그런데 길이 있었다. 계정마다 자가신고로 재사용·2단계 인증을 알려주면 그 계정이 분모에
 * 편입된다. 숨기는 쪽을 택하는 바람에 **사용자는 그 길이 있다는 것조차 알 수 없었다** —
 * 축은 미측정이라 숨겨지고, 숨겨졌으니 켤 생각을 못 하고, 그래서 영영 미측정이었다
 * (2026-08-26 발견).
 *
 * 같은 미측정인데 처리가 갈리던 것도 문제였다. 이상 접속 축은 "확인 불가"로 서 있고
 * 비밀번호 습관만 사라졌다. 사용자에게 두 축은 같은 상태인데 화면이 다르게 말했다.
 *
 * 그래서 지금은 세우되 **물음으로** 세운다. 못 잰다고 말하고, 어떻게 하면 잴 수 있는지
 * 알려주고, 거기로 가는 문을 낸다. 강요는 하지 않는다 — 답하지 않으면 그대로 미측정이고,
 * 미측정은 산식에서 빠진다(blend가 측정된 축만 재정규화한다).
 */
function visibleAxes(_axes: Record<AxisKey, { measured: boolean }>): AxisKey[] {
  return AXIS_ORDER;
}

/**
 * 측정하지 못한 축이 그 사실을 설명하는 문장.
 * "근거 부족"으로만 적어 두면 사용자는 우리가 게을러서인지 아직 볼 것이 없는 것인지
 * 구분할 수 없고, 못 재는 것을 두고 자기가 뭘 잘못했나 생각하게 된다.
 */
const AXIS_UNMEASURED: Partial<Record<AxisKey, string>> = {
  threat: '아직 확인된 접속 기록이 없어요',
  // 비밀번호는 저장하지 않으므로 우리가 알아낼 방법이 없다. 알려주시면 그때부터 잰다.
  hygiene: '비밀번호는 저장하지 않아 우리가 알 수 없어요 — 알려주시면 계산해 드려요',
};

/** 사용자가 직접 켤 수 있는 축에만 문을 낸다. 접속 기록은 사용자가 만들어 낼 수 없다. */
const AXIS_UNMEASURED_CTA: Partial<Record<AxisKey, { label: string; href: string }>> = {
  hygiene: { label: '계정별로 알려주기', href: '/scan' },
};

// 회복 액션 표시 라벨 + 이동 경로(과장 금지 문구 — 무효화 표현 없음). href는 내부 경로(불변).
const ACTION_META: Record<ActionType, { label: string; href: string }> = {
  // 목록(/scan)으로 보낸다. 대시보드에서 바로 처리하지 않는 것은 확인 API가
  //   "사용자가 목록을 본 시점이 곧 인지 시점"이라는 전제 위에 서 있기 때문이다.
  //   목록을 건너뛰고 확인 처리하면 그 전제가 깨진다. 클릭이 하나 느는 편이 맞다.
  acknowledge: { label: '몰랐던 계정 확인하기', href: '/scan' },
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
  // 유출 현황 — 점수 엔진과 **같은 근거**(Breach 원본, resolved=false)를 화면도 쓴다.
  // checkedAt이 null이면 "유출 없음"이 아니라 "아직 대조하지 않음"이다. 둘을 같은 0으로
  // 말하면 아무것도 대조하지 않은 사람에게 안심을 파는 셈이 된다.
  const [breachState, setBreachState] = useState<{
    unresolved: number;
    checkedAt: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/guard')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: GuardDTO }) => {
        if (!alive) return;
        setFeed(body.data.alerts ?? []);
        setBreachState({
          unresolved: (body.data.breaches ?? []).filter((b) => !b.resolved).length,
          checkedAt: body.data.breachCheckedAt ?? null,
        });
      })
      .catch(() => {
        // 못 읽었으면 0으로 내려앉지 않는다 — 그 0이 "유출 없음"으로 읽힌다.
        if (alive) setFeed([]);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  useEffect(() => {
    let alive = true;
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: AccountDTO[] }) => {
        // 실패해도 시드 상수로 되돌아가지 않는다 — 그 조용한 폴백이 숫자 불일치의 원인이었다.
        if (alive) setInv(summarize(body.data ?? []));
      })
      .catch(() => {
        if (alive) setInv(null);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  // 잰 축이 얼마나 두터운가. 4축을 다 재면 1.00, 유출·방치만 잰 상태면 0.55다.
  //   화면이 자기 기준을 따로 갖지 않도록 산식이 쓰는 함수를 그대로 쓴다.
  const mWeight = dto
    ? measuredWeight(AXIS_ORDER.map((k) => ({ ...dto.axes[k], key: k })))
    : 1;
  const measuredAxisCount = dto
    ? AXIS_ORDER.filter((k) => dto.axes[k].measured && dto.axes[k].score !== null).length
    : AXIS_ORDER.length;
  /**
   * 근거가 얇은 점수. 등급 배지와 안심 카피를 여기서 끊는다.
   *
   * 산식은 이미 신뢰 상한으로 숫자를 눌러 두지만, 눌린 숫자에도 "등급 양호"와
   * "안전한 상태예요"가 붙으면 사용자는 여전히 다 재고 나온 결론으로 읽는다.
   * 실제로 4축 중 2축이 카드에 "확인 불가"라고 서 있는데 헤드라인만 양호였다
   * (2026-08-28 prod 실화면). 숫자를 낮추는 일과 말투를 낮추는 일은 별개다.
   */
  const lowConfidence = loadState === 'ready' && !nothingToMeasure && mWeight < SCORE_V2_PARAMS.confidenceDisplayFloor;

  // 근거가 얇으면 "양호"의 안심 표기만 거둔다. 위험은 그대로 위험으로 둔다 — 얇은 근거가
  //   더 나쁜 신호를 완화하는 쪽으로 작동하면 안 된다.
  const scoreClass =
    grade === '위험'
      ? ' is-danger'
      : grade === '주의' || lowConfidence
        ? ' is-warn'
        : '';
  const gaugeClass =
    grade === '위험' ? ' is-danger' : grade === '주의' || lowConfidence ? ' is-warn' : ' is-safe';
  const badgeClass = grade === '양호' && !lowConfidence ? 'badge live' : 'badge warn-badge';

  // 델타 표기(방어) — 상승/하락/변동없음. 스냅샷 1건이면 delta 0.
  const deltaText =
    delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : '변동 없음';
  const deltaClass = delta > 0 ? 'score-up' : delta < 0 ? 'score-up is-down' : 'score-up is-flat';

  // 등급별 헤드라인 서브 카피(정직 표기 — 위험 상태를 "오르는 중"으로 과장하지 않음).
  //   근거가 얇을 때는 등급 대신 측정 상태를 먼저 말한다. 아직 재지 못한 축이 있다는 사실이
  //   지금 점수를 읽는 데 필요한 첫 정보이고, 그걸 알아야 다음에 뭘 할지도 정해진다.
  const scoreSub = lowConfidence
    ? `4축 중 ${measuredAxisCount}축만 잰 결과예요. 나머지는 아직 확인하지 못해 점수에 들어가 있지 않아요.`
    : grade === '양호'
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
  // 추이에 실제로 찍힌 점의 개수. 부제의 "최근 N회"가 이 값에서 나온다.
  const trendCount = dto?.trend?.length ?? 0;
  const hasTrend = trendCount >= 2;
  const weekChange = hasTrend ? (delta >= 0 ? `+${delta}` : `${delta}`) : '관리 시작';
  const weekChangeCls = !hasTrend ? '' : delta > 0 ? ' up' : delta < 0 ? ' danger' : '';
  // 또래 대비 상위 백분위(데모 기준 근사 — 분포 상수 spread로 z→percentile). 평균 아래면 미표기.
  const aboveePeer = score >= peerLast;
  const topPct = Math.min(99, Math.max(1, Math.round(50 - ((score - peerLast) / 22) * 34)));

  const bars = [
    { key: '소셜 로그인', dot: 'is-accent', cls: '', count: inv?.social ?? 0 },
    { key: '해외 서비스', dot: 'is-caution', cls: ' is-caution', count: inv?.overseas ?? 0 },
    { key: '미사용 12개월+', dot: 'is-warn', cls: ' is-warn', count: inv?.unused ?? 0 },
    // 모르는 것을 위험 옆에 나란히 둔다. 감추면 "미사용 11개"만 보여 규모가 왜곡되고,
    // 휴면에 섞으면 모르는 것이 위험이 된다.
    { key: '사용일 미상', dot: '', cls: '', count: inv?.unknownLastUsed ?? 0 },
  ];

  // 4축 진단·추천은 API가 준비된 경우 노출. 정리 요청을 접수했다고 숨기지 않는다 —
  //   담기는 조치가 아니므로 취약 축은 그대로 남아 있고, 화면이 그걸 감추면 안 된다.
  const showDiagnostics = loadState === 'ready' && dto !== null;
  // 잴 수 있는 축만 카드로 세운다(위 visibleAxes 주석 참조). 산식은 4축 그대로다.
  const axesToShow = dto ? visibleAxes(dto.axes) : AXIS_ORDER;
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
  // "우선 조치"는 하나다. 최약축 액션이 둘 이상일 때(예: 확인·정리가 둘 다 방치 계정 축)
  //   배지를 전부에 붙이면 무엇부터인지를 말하지 않는 것과 같다. 정렬이 이미
  //   최약축·상승폭 순이므로 그 첫 칸이 우선 조치다.
  const primaryAction =
    recommendations.find((r) => r.axis === weakestAxis)?.actionType ?? null;

  // "점수 올리는 법"은 이 사용자의 실제 레버 전부다(추천 카드는 상위 3개만 보여준다).
  //   예전에는 세 줄이 박혀 있어서, 최약축이 "몰랐던 계정"인 사람에게도 "12개월 이상 안 쓴
  //   소셜 연결을 정리하세요"라고 말했다 — 무대 계정에는 그 기준에 걸리는 계정이 없었다.
  const guideItems = dto
    ? [...dto.expectedGains].sort((a, b) => b.expectedGain - a.expectedGain)
    : [];

  // 로그인 후 3.7초 위험 알림 모달: 정리 전에만·흐름당 1회.
  //   0건이면 띄우지 않는 것은 08-18에 고쳤다("위험 계정 0개가 발견됐어요"를 말하던 자리).
  //   그런데 1건에도 뜨는 상태로 남아 있어서, 흐름을 끊을 만큼 많을 때만 띄우도록 좁혔다.
  useEffect(() => {
    if (cleaned) return;
    if (!inv || !shouldAlertRisk(inv.highRisk, inv.total)) return;
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
          {/* 근거가 얇으면 등급을 말하지 않는다. 등급은 4축을 다 재고 나서 붙는 결론인데,
              두 축을 못 잰 채로 "양호"를 달면 화면이 알지 못하는 것을 아는 척하게 된다.
              대신 무엇이 남았는지를 배지 자리에 그대로 적는다. */}
          {!nothingToMeasure &&
            (lowConfidence ? (
              <span className={badgeClass}>{measuredAxisCount}/4축 측정</span>
            ) : (
              <span className={badgeClass}>등급 {grade}</span>
            ))}
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
          {/* 담아 둔 정리는 "예정"으로만 말한다. 접수했다고 점수가 오르지는 않는다.
              전제를 함께 적는 이유: 이 줄과 추천 액션은 서로 다른 세계를 말한다. 담아 둔
              정리만 끝냈을 때의 도달점이라 추천 액션의 상승폭은 여기에 들어 있지 않은데,
              둘이 나란히 서면 "확인하면 +36인데 다 끝내도 35점"이라는 모순으로 읽힌다. */}
          {showProjection && (
            <p className="score-sub score-pending">
              담아 둔 정리 {pendingCleanup}건<strong>만</strong> 끝냈을 때{' '}
              <strong>{projectedScore}점</strong> — 아래 추천 액션은 여기에 들어 있지 않아요
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

      {/* 안전 진단 — 잴 수 있는 축만 세운다. 미측정 축은 이유를 밝혀 표기한다. */}
      {showDiagnostics && (
        <>
          <h2 className="section-label">안전 진단 · {axesToShow.length}축</h2>
          <div className="stat-grid">
            {axesToShow.map((key) => {
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
                      : /* 못 재는 축은 이유를 말한다. "근거 부족"만 적어 두면 사용자는
                           우리가 게을러서인지 원래 알 수 없는 것인지 구분할 수 없다.
                           아래 두 축은 성격이 다르다 — 하나는 원칙상 못 재고,
                           하나는 아직 볼 것이 없다. */
                        AXIS_UNMEASURED[key] ??
                        `확인된 계정 ${a.coveredCount}/${a.totalCount} — 근거 부족`}
                  </p>
                  {!measured && AXIS_UNMEASURED_CTA[key] && (
                    <Link
                      href={AXIS_UNMEASURED_CTA[key]!.href}
                      className="btn btn-secondary compact"
                    >
                      {AXIS_UNMEASURED_CTA[key]!.label}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 추천 액션 — 기대 상승폭 기반(최약축 우선). 미준비 시 정적 네비 폴백 */}
      <h2 className="section-label">추천 액션</h2>
      {/* 상승폭은 각각 그 액션 하나만 했을 때의 값이다. 축이 서로 물려 있어 더한 만큼
          오르지는 않는다 — 적어 두지 않으면 사용자가 합산해서 기대한다. */}
      {showRecommendations && (
        <p className="panel-note">
          각 상승폭은 그 조치 하나만 했을 때의 값이에요. 여러 개를 더한 만큼 오르지는 않습니다.
        </p>
      )}
      <div className="action-grid">
        {showRecommendations
          ? recommendations.map((rec) => {
              const meta = ACTION_META[rec.actionType];
              const gain = Math.round(rec.expectedGain);
              const isPrimary = rec.actionType === primaryAction;
              const count = rec.accountIndices.length;
              const axisName = AXIS_META[rec.axis].label.split(' — ')[0];
              // 상승폭 0인 카드가 "점수가 오릅니다"라고 말하던 자리. 미측정 축의 액션은
              //   해도 오르지 않는다 — 잴 근거가 없어서다. 카드를 지우면 그 축을 켤 길이
              //   또 사라지므로(AXIS_UNMEASURED_CTA 주석과 같은 함정) 지우지 않고 사실대로 적는다.
              const axisMeasured = dto?.axes[rec.axis].measured ?? false;
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
                    {count}개 계정에 적용돼요 ·{' '}
                    {gain > 0
                      ? `${axisName} 점수가 오릅니다`
                      : axisMeasured
                        ? '지금 점수로는 오르지 않지만 위험은 줄어요'
                        : `아직 ${axisName} 점수를 재지 못해 지금은 오르지 않아요 — 알려주시면 그때부터 잽니다`}
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
          {/* "확인된 계정 N개 기준"의 N은 오래도록 전체 계정 수였다. 227개를 찾아 놓고 그중
              180개가 언제 썼는지도 모르는 상태에서 화면은 227개를 다 확인했다고 말했다
              (2026-08-28 prod 실화면). 확인의 분자는 사용 이력을 아는 계정 수(surface 축의
              coveredCount)다. 전체 수는 바로 위 큰 숫자가 이미 말하고 있다. */}
          <div className="delta">
            {inv === null || dto === null
              ? '불러오는 중'
              : `사용 이력을 확인한 계정 ${dto.axes.surface.coveredCount}개`}
          </div>
        </div>
        <div className="stat">
          <div className="lbl">유출 발견</div>
          <div className="num danger">
            {breachState === null || breachState.checkedAt === null ? (
              '—'
            ) : (
              <CountUp value={breachState.unresolved} />
            )}
          </div>
          <div
            className={breachState && breachState.unresolved > 0 ? 'delta is-danger' : 'delta'}
          >
            {breachState === null
              ? '불러오는 중'
              : breachState.checkedAt === null
                ? '아직 대조하지 않았어요'
                : breachState.unresolved > 0
                  ? '미해결 유출'
                  : '미해결 없음'}
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
              {demo.benchmark.sub}
              {trendCount > 0 ? ` · 최근 ${trendCount}회` : ''} · {demo.benchmark.peerNote}
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
            {/* 하지 않는 일은 적지 않는다 — 이상 접속 자동 점검은 이 제품의 명시적 배제 항목이다. */}
            <p className="panel-note">정리 후에도 이레이지가 유출 여부를 계속 지켜봅니다.</p>
          </div>
          <span className="badge">{demo.benchmark.badge}</span>
        </div>
        <div className="stat-grid">
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
          {/* 유출 대조 이력 — null은 "유출 없음"이 아니라 "아직 대조하지 않음"이다.
              대조한 적이 없으면 조회로 가는 문을 함께 낸다. 지켜본다고 말하려면 먼저
              한 번은 봐야 하고, 그 한 번은 사용자가 눌러야 시작된다. */}
          <div className="stat">
            <div className="lbl">마지막 유출 대조</div>
            <div className="num">
              {breachState === null
                ? '—'
                : breachState.checkedAt === null
                  ? '아직 없음'
                  : relativeTime(new Date(breachState.checkedAt))}
            </div>
            <div className="delta">
              {breachState === null ? (
                '불러오는 중'
              ) : breachState.checkedAt === null ? (
                <Link href="/breach">지금 확인하기 →</Link>
              ) : (
                `${RESCAN_PERIOD_LABEL} 자동으로도 다시 봅니다`
              )}
            </div>
          </div>
          {/* 주기·범위는 정본 상수(lib/rescan-schedule.ts)에서 온다. 예전에는 "7일 후"와
              "이상 접속 자동 점검"이 화면에 박혀 있었는데 둘 다 사실이 아니었다. */}
          <div className="stat">
            <div className="lbl">자동 점검</div>
            <div className="num">{RESCAN_PERIOD_LABEL}</div>
            <div className="delta is-up">
              {rescanTimeLabel()} · {RESCAN_SCOPE_LABEL}
            </div>
          </div>
        </div>
      </section>

      {/* 점수 올리는 법 모달 */}
      {guideOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setGuideOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-score-title">
            <h3 id="modal-score-title">점수 올리는 법</h3>
            {guideItems.length > 0 ? (
              <ol>
                {guideItems.map((g) => {
                  const gain = Math.round(g.expectedGain);
                  return (
                    <li key={g.actionType}>
                      {ACTION_META[g.actionType].label} — {g.accountIndices.length}개 계정
                      {gain > 0
                        ? ` · +${gain}점`
                        : dto?.axes[g.axis].measured
                          ? ' · 점수는 그대로지만 위험은 줄어요'
                          : ' · 아직 잴 수 없어 점수는 그대로예요'}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p>
                아직 잴 계정이 없어요. 계정을 먼저 찾으면 무엇부터 하면 되는지 여기에
                적어 드립니다.
              </p>
            )}
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
