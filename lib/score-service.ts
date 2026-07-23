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
  DEMO_USER_ID,
} from './dummy-data';

const DAY = 86_400_000;
const SNAPSHOT_REFRESH_MS = 24 * 60 * 60 * 1000; // 동일 점수여도 24h 경과 시 heartbeat 기록
const TREND_POINTS = 6;
const SUSPICIOUS_WINDOW_DAYS = 90; // T축 이상접속 관측 윈도우(SSOT·시드 정합)

// 스냅샷 axes JSON 형태(재조회·이력 렌더용)는 score-v2의 AxesSnapshot·toAxesSnapshot 공유.

export type ScoreServiceResult = {
  score: number; // 종합(composite). 측정 불가 시 0(정직 표기는 measured 부재로 별도 처리)
  grade: Grade;
  delta: number; // 직전 스냅샷 대비
  trend: number[]; // 최근 스냅샷 시계열(오름차순, 현재 포함)
  coverage: number; // 헤드라인 = surface 축 coverage(0~1)
  coveredCount: number;
  totalCount: number;
  fallback: 'none' | 'demo-user' | 'memory'; // 정직 표기용(어느 데이터로 계산했는지)
  // ── v2 additive(기존 필드 불변, 신규 필드만 추가) ──
  axes: Record<AxisKey, AxisScore>;
  weakestAxis: AxisKey | null;
  expectedGains: ExpectedGainItem[];
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
      cleanupRequests: {
        where: { status: 'done' },
        select: { actionType: true },
      },
      // T축 coverage 관측 모수 — 접속기록을 하나라도 보유한 계정(suspicious 여부 무관).
      _count: { select: { accessLogs: true } },
    },
  });
}

// DB row → v2 엔진 입력 행(회복규칙·관측 신호 파생 포함)
function toRowV2(r: DbAccountRow): ScoreRowV2 {
  const done = new Set(r.cleanupRequests.map((c) => c.actionType));
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
    // 위생 판정 근거 보유 여부. 시드·OAuth 연동은 수집 경로가 있어 관측으로 본다.
    //   사용자가 서비스명만 적어 직접 추가한 계정(source=user_input)은 신호를 하나라도
    //   신고했을 때만 관측 전환 — 미신고를 "깨끗한 계정"으로 계상하지 않는다(H축 분모).
    passwordSignalObserved:
      r.source !== 'user_input' || r.passwordReused || r.twoFactorEnabled,
    discovered: r.discovered,
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
): Promise<{ delta: number; trend: number[] }> {
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
  const trend = recent.map((s) => s.score).reverse();
  // delta = 현재 − 직전 스냅샷(append 전의 최신). 이력 1점뿐이면 0.
  const delta = latest ? score - latest.score : 0;
  return { delta, trend: trend.length > 0 ? trend : [score] };
}

// v2 엔진 결과 → 서비스 결과 조립(헤드라인 coverage = surface 축).
function buildResult(
  v2: ReturnType<typeof scoreV2>,
  fallback: ScoreServiceResult['fallback'],
  delta: number,
  trend: number[] | null,
): ScoreServiceResult {
  const surface = v2.axes.surface;
  const score = v2.composite ?? 0;
  return {
    score,
    grade: v2.grade ?? '위험',
    delta,
    trend: trend ?? [score],
    coverage: surface.coverage,
    coveredCount: surface.coveredCount,
    totalCount: surface.totalCount,
    fallback,
    axes: v2.axes,
    weakestAxis: v2.weakestAxis,
    expectedGains: v2.expectedGains,
  };
}

export async function getScoreForUser(userId: string): Promise<ScoreServiceResult> {
  try {
    let rows = await queryAccounts(userId);
    let fallback: ScoreServiceResult['fallback'] = 'none';
    let effectiveUserId = userId;

    // 실계정 0건 → 시드 유저 폴백(스냅샷 시계열도 시드 유저 것을 이어감 — 데모 연속성).
    if (rows.length === 0 && userId !== DEMO_USER_ID) {
      rows = await queryAccounts(DEMO_USER_ID);
      fallback = 'demo-user';
      effectiveUserId = DEMO_USER_ID;
    }
    if (rows.length === 0) throw new Error('no accounts in DB');

    const v2 = scoreV2(rows.map(toRowV2));
    const { delta, trend } = await appendSnapshotAndTrend(
      effectiveUserId,
      v2.composite ?? 0,
      v2.axes.surface.coverage,
      v2.axes.surface.coveredCount,
      toAxesSnapshot(v2.axes),
    );

    return buildResult(v2, fallback, delta, trend);
  } catch (e) {
    // DB 미연결 → 메모리 폴백(동일 엔진·시드 신호. 스냅샷 불가 → 추이 1점, T 미측정).
    console.warn('[score-service] DB unavailable, memory fallback:', (e as Error).message);
    return buildResult(scoreV2(memoryRowsV2()), 'memory', 0, null);
  }
}
