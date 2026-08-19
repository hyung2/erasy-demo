// 점수 서비스 v2 — userId 신호 집계(DB) → 다차원 엔진(lib/score-v2) → ScoreSnapshot append.
// GET /api/score(route)와 scripts/verify-score-db-v2.ts가 동일 코드 경로를 공유한다(런타임 실측 정합).
// 정본: 03-step02-mvp/score-spec-v2-multidim.md. 폴백 서열: 실계정 → 시드 유저(DB) → dummy-data(메모리).
// v1(lib/score.ts) 산식은 이 서비스에서 미사용(엔진 교체). DTO는 additive 확장(기존 필드 shape 불변).
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import {
  scoreV2,
  toAxesSnapshot,
  type ScoreRowV2,
  type AxisKey,
  type AxisScore,
  type AxesSnapshot,
  type ExpectedGainItem,
  type Grade,
} from './score-v2';
import {
  accounts as dummyAccounts,
  breaches as dummyBreaches,
  deleteRequests as dummyRequests,
} from './dummy-data';
import { projectRecovery, type RecoveryProjection } from './score-projection';

const DAY = 86_400_000;
const SNAPSHOT_REFRESH_MS = 24 * 60 * 60 * 1000; // 동일 점수여도 24h 경과 시 heartbeat 기록
const TREND_POINTS = 6;
const SUSPICIOUS_WINDOW_DAYS = 90; // T축 이상접속 관측 윈도우(SSOT·시드 정합)

/**
 * 비밀번호 위생 신호를 관측했다고 볼 수 있는 출처 — **허용 목록**.
 *  - `seed`: 데모 페르소나. 재사용·2FA가 시드에 정의돼 있다.
 *  - `oauth_linked`: 로그인 provider 본인 계정. 연동 경로로 상태를 안다.
 * 나머지(`user_input`·`mail_scan`·`social_link`)는 **서비스명만 알 뿐 비밀번호를 모른다.**
 * 여기 없는 출처는 자동으로 미관측이 된다 — 출처가 늘 때 이 목록을 다시 보게 만드는 것이 목적이다.
 */
const SIGNAL_OBSERVED_SOURCES = new Set<string>(['seed', 'oauth_linked']);

// 스냅샷 axes JSON 형태(재조회·이력 렌더용)는 score-v2의 AxesSnapshot·toAxesSnapshot 공유.

// 추이 점 1개(점수 + 기록 시각). 차트 x축 라벨의 근거 — 월별 더미 상수 대체.
export type TrendPoint = { score: number; at: string };

export type ScoreServiceResult = {
  score: number; // 종합(composite). 측정 불가 시 0(정직 표기는 measured 부재로 별도 처리)
  grade: Grade;
  delta: number; // 직전 스냅샷 대비
  trend: number[]; // 최근 스냅샷 시계열(오름차순, 현재 포함)
  trendPoints: TrendPoint[]; // 위 시계열 + 기록 시각. 이력 없으면 빈 배열
  coverage: number; // 헤드라인 = surface 축 coverage(0~1)
  coveredCount: number;
  totalCount: number;
  // 정직 표기용(어느 데이터로 계산했는지). 'empty'는 아직 잴 계정이 없는 상태 —
  // 예전에는 이 자리에서 시드 사용자 데이터로 폴백했지만, 그러면 처음 들어온 사람이
  // 남의 계정 24개를 자기 것으로 보게 된다.
  fallback: 'none' | 'empty' | 'demo-user' | 'memory';
  // ── v2 additive(기존 필드 불변, 신규 필드만 추가) ──
  axes: Record<AxisKey, AxisScore>;
  weakestAxis: AxisKey | null;
  expectedGains: ExpectedGainItem[];
  // 회복 투영 — 이 사용자의 실제 계정·정리 큐로 계산한다. 결과 화면(/cleanup/result)이
  // 시드로 자체 계산하던 것을 대체한다(그 경로는 계정 수와 무관하게 항상 24→93이었다).
  recovery: RecoveryProjection;
  // 이미 끝낸 정리가 실제로 올린 폭. 완료분이 없으면 null — 그때는 결과 화면이 투영(예상)만
  // 말한다. 원페이저 4단계("내가 뭘 고쳤는지를 숫자로")가 요구하는 건 예상이 아니라 이 값이다.
  cleaned: {
    completedCount: number;
    before: number; // 정리하지 않았다면의 점수
    after: number; // 지금 점수
    gain: number;
  } | null;
};

type DbAccountRow = Awaited<ReturnType<typeof queryAccounts>>[number];

// 신호 집계 쿼리 — 필요한 신호만(유출 미해결·최근 90일 이상접속·완료된 정리·접속기록 보유수).
function queryAccounts(userId: string) {
  const suspiciousCutoff = new Date(Date.now() - SUSPICIOUS_WINDOW_DAYS * DAY);
  return prisma.account.findMany({
    where: { userId },
    include: {
      breaches: {
        where: { resolved: false },
        select: { exposedFields: true },
      },
      accessLogs: {
        where: { suspicious: true, timestamp: { gte: suspiciousCutoff } },
        select: { id: true },
        take: 1,
      },
      // 완료분은 신호 반영(removed·passwordChanged…), 미완료분은 회복 투영의 삭제 표적으로 쓴다.
      // status 필터를 걸어 완료분만 가져오면 "담아 둔 정리"를 알 수 없어 투영이 시드로 회귀한다.
      cleanupRequests: {
        select: { actionType: true, status: true },
      },
      // T축 coverage 관측 모수 — 접속기록을 하나라도 보유한 계정(suspicious 여부 무관).
      _count: { select: { accessLogs: true } },
    },
  });
}

// DB row → v2 엔진 입력 행(회복규칙·관측 신호 파생 포함)
/** 이 계정에 아직 끝나지 않은 삭제·연결해제 요청이 담겨 있는가 — 회복 투영의 삭제 표적 판정. */
function hasPendingRemoval(r: DbAccountRow): boolean {
  return r.cleanupRequests.some(
    (c) =>
      (c.actionType === 'delete' || c.actionType === 'revoke') &&
      (c.status === 'queued' || c.status === 'in_progress'),
  );
}

function toRowV2(r: DbAccountRow): ScoreRowV2 {
  const done = new Set(
    r.cleanupRequests.filter((c) => c.status === 'done').map((c) => c.actionType),
  );
  const unresolved = r.breaches;
  return {
    provider: r.provider,
    category: r.category,
    lastUsedDays:
      r.lastUsedAt === null
        ? null
        : Math.max(0, Math.floor((Date.now() - r.lastUsedAt.getTime()) / DAY)),
    twoFactorEnabled: r.twoFactorEnabled,
    passwordReused: r.passwordReused,
    // 위생 판정 근거 보유 여부(H축 분모 편입 조건).
    //   **허용 목록**으로 판정한다. 거부 목록(`source !== 'user_input'`)이었을 때,
    //   나중에 추가된 mail_scan(07-28)·social_link(07-29)이 자동으로 "관측됨"에 편입돼
    //   비밀번호를 아무것도 모르는 계정이 "깨끗한 계정"으로 계상됐다. 재사용률이 희석되면서
    //   **계정을 발견할수록 점수가 오르는** 역전이 실측됐다(2026-08-04, 15개 추가에 24→27).
    //   computeHygiene 주석이 경고한 바로 그 실패이며, 가드가 쓰인 뒤 출처가 늘 때
    //   갱신되지 않아 생겼다. 허용 목록이면 신규 출처의 기본값이 "미관측"이라 같은 실수가 반복되지 않는다.
    //   신호를 하나라도 신고하면 그 시점부터 관측으로 전환된다.
    passwordSignalObserved:
      SIGNAL_OBSERVED_SOURCES.has(r.source) || r.passwordReused || r.twoFactorEnabled,
    discovered: r.discovered,
    // 확인 시각이 있으면 "미인지" 상태가 해소된 것 — S축 미인지 인자가 빠진다.
    acknowledged: r.acknowledgedAt !== null,
    breachedUnresolved: unresolved.length > 0,
    breachedPasswordExposed: unresolved.some((b) =>
      b.exposedFields.includes('비밀번호'),
    ),
    suspiciousRecent: r.accessLogs.length > 0,
    accessLogObserved: r._count.accessLogs > 0,
    removed: done.has('delete') || done.has('revoke'),
    passwordChanged: done.has('password_change'),
    sessionsCleared: done.has('logout_sessions'),
  };
}

// 메모리 폴백(DB 미연결) — dummy-data 신호로 동일 엔진 계산. AccessLog는 메모리에 없어 관측 0(T 미측정).
function memoryRowsV2(): ScoreRowV2[] {
  return dummyAccounts.map((a) => {
    const b = dummyBreaches.find((x) => x.service === a.service && !x.resolved) ?? null;
    const removed = dummyRequests.some(
      (r) => r.service === a.service && r.status === '완료',
    );
    return {
      provider:
        a.linkMethod === 'email-password'
          ? ('manual' as const)
          : (a.linkMethod.replace('-oauth', '') as ScoreRowV2['provider']),
      category: a.category,
      lastUsedDays: a.lastUsedDays,
      twoFactorEnabled: a.twoFactorEnabled ?? false,
      passwordReused: a.passwordReused ?? false,
      passwordSignalObserved: true, // 시드 인벤토리는 전부 수집 경로 있음
      discovered: a.discovered ?? false,
      acknowledged: false, // 메모리 폴백은 시드 신호 — 확인 이력 없음
      breachedUnresolved: b !== null,
      breachedPasswordExposed: b?.exposedFields.includes('비밀번호') ?? false,
      suspiciousRecent: false,
      accessLogObserved: false,
      removed,
      passwordChanged: false,
      sessionsCleared: false,
    };
  });
}

// 스냅샷 조건부 append + 추이 산출. 실패해도 점수 응답은 유지(스냅샷은 부가 이력).
async function appendSnapshotAndTrend(
  userId: string,
  score: number,
  coverage: number,
  coveredCount: number,
  axes: AxesSnapshot,
): Promise<{ delta: number; trend: number[]; trendPoints: TrendPoint[] }> {
  const latest = await prisma.scoreSnapshot.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const shouldAppend =
    !latest ||
    latest.score !== score ||
    Date.now() - latest.createdAt.getTime() > SNAPSHOT_REFRESH_MS;

  if (shouldAppend) {
    await prisma.scoreSnapshot.create({
      // axes는 nullable Json — Prisma InputJsonValue로 캐스팅(중첩 null 허용 위해).
      data: { userId, score, coverage, coveredCount, axes: axes as unknown as Prisma.InputJsonValue },
    });
  }

  const recent = await prisma.scoreSnapshot.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: TREND_POINTS,
  });
  const points: TrendPoint[] = recent
    .map((s) => ({ score: s.score, at: s.createdAt.toISOString() }))
    .reverse();
  // delta = 현재 − 직전 스냅샷(append 전의 최신). 이력 1점뿐이면 0.
  const delta = latest ? score - latest.score : 0;
  return {
    delta,
    trend: points.length > 0 ? points.map((p) => p.score) : [score],
    trendPoints: points,
  };
}

// v2 엔진 결과 → 서비스 결과 조립(헤드라인 coverage = surface 축).
function buildResult(
  v2: ReturnType<typeof scoreV2>,
  fallback: ScoreServiceResult['fallback'],
  delta: number,
  trend: number[] | null,
  trendPoints: TrendPoint[],
  recovery: RecoveryProjection,
  cleaned: ScoreServiceResult['cleaned'] = null,
): ScoreServiceResult {
  const surface = v2.axes.surface;
  const score = v2.composite ?? 0;
  return {
    score,
    grade: v2.grade ?? '위험',
    delta,
    trend: trend ?? [score],
    trendPoints,
    coverage: surface.coverage,
    coveredCount: surface.coveredCount,
    totalCount: surface.totalCount,
    fallback,
    axes: v2.axes,
    weakestAxis: v2.weakestAxis,
    expectedGains: v2.expectedGains,
    recovery,
    cleaned,
  };
}

/**
 * 이미 끝낸 정리가 점수를 **실제로** 얼마나 올렸는가.
 *
 * 결과 화면은 오래도록 투영(예상 도달치)만 보여줬다. 완료로 갈 길이 없었으니 그럴 수밖에
 * 없었는데, 이제 정리를 닫을 수 있으므로 "예상"과 "실제로 오른 폭"을 구분해야 한다.
 * 원페이저 4단계가 요구하는 것은 예상이 아니라 **"내가 뭘 고쳤는지를 숫자로"**다.
 *
 * 재는 법: 완료 표시를 없던 일로 되돌린 행으로 같은 엔진을 한 번 더 돌린다. 그 값이
 * "정리하지 않았다면의 점수"이고, 현재 점수와의 차이가 실제 상승분이다. 스냅샷 두 점을 빼는
 * 방식은 그 사이에 계정이 늘거나 유출이 새로 잡혀도 정리 덕으로 계상돼 과대평가가 된다.
 */
function computeCleaned(
  rows: DbAccountRow[],
  engineRows: ScoreRowV2[],
  after: number,
): ScoreServiceResult['cleaned'] {
  const completed = rows.filter((r) =>
    r.cleanupRequests.some(
      (c) =>
        (c.actionType === 'delete' || c.actionType === 'revoke') && c.status === 'done',
    ),
  ).length;
  if (completed === 0) return null;

  const asIfUncleaned = engineRows.map((r) => ({
    ...r,
    removed: false,
    passwordChanged: false,
    sessionsCleared: false,
  }));
  const before = scoreV2(asIfUncleaned).composite ?? 0;
  return { completedCount: completed, before, after, gain: after - before };
}

export async function getScoreForUser(userId: string): Promise<ScoreServiceResult> {
  try {
    const rows = await queryAccounts(userId);

    // 실계정 0건 → 빈 상태. 예전에는 시드 유저 데이터로 폴백했는데, 그러면 방금 가입한
    // 사람에게 남의 계정 24개가 자기 점수로 표시된다. 아직 아무것도 못 찾은 것은
    // "측정 불가"이지 "24점"이 아니므로, 화면이 그 사실을 받도록 빈 결과를 돌려준다.
    // (DB 자체가 죽은 경우는 아래 catch가 따로 받는다 — 장애 무중단은 그대로 유지)
    if (rows.length === 0) {
      return buildResult(scoreV2([]), 'empty', 0, null, [], projectRecovery({ rows: [], deleteIdx: [] }));
    }

    const engineRows = rows.map(toRowV2);
    const v2 = scoreV2(engineRows);
    // 회복 투영은 점수와 **같은 rows**로 계산한다. 다른 입력을 쓰면 대시보드와 결과 화면의
    // 출발점이 어긋난다. 삭제 표적은 이 사용자가 실제로 담아 둔 미완료 정리 요청뿐이다.
    const recovery = projectRecovery({
      rows: engineRows,
      deleteIdx: rows.reduce<number[]>((acc, r, i) => {
        if (hasPendingRemoval(r)) acc.push(i);
        return acc;
      }, []),
    });
    const { delta, trend, trendPoints } = await appendSnapshotAndTrend(
      userId,
      v2.composite ?? 0,
      v2.axes.surface.coverage,
      v2.axes.surface.coveredCount,
      toAxesSnapshot(v2.axes),
    );

    return buildResult(
      v2,
      'none',
      delta,
      trend,
      trendPoints,
      recovery,
      computeCleaned(rows, engineRows, v2.composite ?? 0),
    );
  } catch (e) {
    // DB 미연결 → 메모리 폴백(동일 엔진·시드 신호. 스냅샷 불가 → 추이 1점, T 미측정).
    console.warn('[score-service] DB unavailable, memory fallback:', (e as Error).message);
    // 이력 없음 → trendPoints 빈 배열. 차트는 "쌓이면 보여드려요"로 방어(가짜 선 금지).
    // 메모리 폴백은 입력이 시드 신호이므로 투영도 시드 경로를 쓴다(점수와 입력 일치 유지).
    // fallback 표기가 'memory'로 내려가므로 화면이 이 상태를 숨기지 않는다.
    return buildResult(scoreV2(memoryRowsV2()), 'memory', 0, null, [], projectRecovery());
  }
}
