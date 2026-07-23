// 데모 데이터 프로비저닝 — 한 사용자에게 24계정 인벤토리 일습(계정·유출·접속기록·정리요청·이력 스냅샷)을 적재.
//
// 두 곳이 공유한다:
//   1) prisma/seed.ts        — 시드 유저(seed-user-demo)에 `seed-` 접두사로 적재. 멱등 upsert(재실행 drift 0).
//   2) auth.ts signIn 콜백    — 실 로그인 사용자 첫 진입 시 본인 소유로 복제(B2 해소).
//
// B2 배경: 이전 구조는 "실계정 0건이면 시드 유저 데이터를 대신 보여주는" 폴백이었다.
//   읽기는 통했지만 쓰기(자가신고 PATCH·직접추가 POST)는 소유권 검증에서 404이거나,
//   본인 계정 1건이 생기는 순간 폴백 조건이 풀려 인벤토리·점수가 붕괴했다.
//   로그인 시점에 본인 소유 데이터를 만들어 두면 읽기·쓰기 경로가 같은 소유자를 보게 된다.
//
// 자격증명 미저장 원칙 유지 — 비밀번호 값·해시 없음. 점수 신호는 전부 메타(불리언·타임스탬프).
// 신호 정본: 03-step02-mvp/score-spec-v2-multidim.md
import type {
  PrismaClient,
  Prisma,
  Provider,
  RiskTag,
  ActionType,
  CleanupStatus,
} from '@prisma/client';
import {
  accounts,
  breaches,
  deleteRequests,
  type Account as DummyAccount,
  type LinkMethod,
} from './dummy-data';
import { scoreV2, toAxesSnapshot, type ScoreRowV2 } from './score-v2';

const DAY = 86_400_000;

function toProvider(m: LinkMethod): Provider {
  if (m === 'email-password') return 'manual';
  return m.replace('-oauth', '') as Provider;
}

// lastUsedDays(상대일) → 절대 시각(스키마 정본은 lastUsedAt DateTime)
function lastUsedAt(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

// dummy breachDate "2018-12"(월 정밀도) → 01일 정규화
function parseBreachDate(s: string): Date {
  return new Date(`${s}-01T00:00:00Z`);
}

// 유출 미해결 조회(서비스명 매칭) — Account.breached 캐시가 아닌 Breach가 SSOT
function unresolvedBreachOf(service: string) {
  return breaches.find((b) => b.service === service && !b.resolved) ?? null;
}

// 구독 서비스(unsubscribe 후보 태그) — 점수 무영향, FE 칩용 메타
const SUBSCRIPTION_SERVICES = new Set(['Netflix', 'Spotify', 'Apple Music', '멜론']);

// riskTags 파생(리터럴 나열 금지 — 신호에서 산출)
function deriveRiskTags(a: DummyAccount): RiskTag[] {
  const tags: RiskTag[] = [];
  if (unresolvedBreachOf(a.service)) tags.push('breach');
  if (a.passwordReused) tags.push('reuse');
  if (a.unusedMonths >= 12) tags.push('dormant');
  if (toProvider(a.linkMethod) === 'manual' && !a.twoFactorEnabled) tags.push('no2fa');
  if (SUBSCRIPTION_SERVICES.has(a.service)) tags.push('subscription');
  return tags;
}

// ── 접속기록 — 이상접속 1건(뽐뿌 a17, 3일 전, 위치 미상) + 정상 4건 ──
const ACCESS_LOGS: Array<{
  key: string; // id 접미(접두사와 조합) — 시드 유저는 seed-al-01… 그대로 유지
  accountKey: string; // dummy id (a17 등)
  daysAgo: number;
  location: string;
  device: string;
  suspicious: boolean;
}> = [
  { key: 'al-01', accountKey: 'a17', daysAgo: 3, location: '미상', device: 'Unknown', suspicious: true },
  { key: 'al-02', accountKey: 'a17', daysAgo: 600, location: '서울, KR', device: 'Chrome / Windows', suspicious: false },
  { key: 'al-03', accountKey: 'a19', daysAgo: 0, location: '서울, KR', device: 'Chrome / Windows', suspicious: false },
  { key: 'al-04', accountKey: 'a01', daysAgo: 0, location: '서울, KR', device: 'Chrome / Windows', suspicious: false },
  { key: 'al-05', accountKey: 'a15', daysAgo: 420, location: '서울, KR', device: 'Safari / macOS', suspicious: false },
];

// ── 정리 요청 — dummy deleteRequests 정합(싸이월드 revoke done = 회복규칙 실증) ──
const CLEANUP_ACTION: Record<string, ActionType> = {
  싸이월드: 'revoke', // naver 연결 해제
  Quora: 'delete',
  Medium: 'delete',
  카카오스토리: 'revoke',
};
const CLEANUP_STATUS: Record<string, CleanupStatus> = {
  완료: 'done',
  진행중: 'in_progress',
  요청됨: 'queued',
};
const CLEANUP_DONE_DAYS_AGO = 1; // 싸이월드 done 시각(완료 이력 = 회복 반영 시점)

const SUSPICIOUS_WINDOW_DAYS = 90; // T축 이상접속 관측 윈도우(score-service와 동일 SSOT)

// ── 이력 스냅샷 시점 ──
// 임의값 금지: 각 시점의 신호 상태를 v2 엔진으로 재계산한다.
// 8일 전 = 이상접속 발생 전 / 3일 전 = 이상접속 반영 시점. 정리 완료(1일 전)는 두 시점 모두 미반영.
const SNAPSHOT_POINTS = [
  { key: 'ss-01', daysAgo: 8 },
  { key: 'ss-02', daysAgo: 3 },
];

// 특정 과거 시점(daysAgo)의 신호 상태 → v2 엔진 입력 행.
// 단순화(승계): 휴면 일수는 현재 기준 고정한다. 시점별로 되감으면 12/24개월 경계를 넘나들며
// 스냅샷이 실행 시각에 따라 흔들리기 때문(경계 드리프트 배제). 시점 차등은 이벤트 신호에만 적용.
function rowsAt(snapshotDaysAgo: number): ScoreRowV2[] {
  const visibleLogs = ACCESS_LOGS.filter((l) => l.daysAgo >= snapshotDaysAgo);
  return accounts.map((a) => {
    const b = unresolvedBreachOf(a.service);
    const mine = visibleLogs.filter((l) => l.accountKey === a.id);
    const cleanupDone =
      deleteRequests.some(
        (r) => r.service === a.service && CLEANUP_STATUS[r.status] === 'done',
      ) && snapshotDaysAgo < CLEANUP_DONE_DAYS_AGO;
    return {
      provider: toProvider(a.linkMethod),
      category: a.category,
      lastUsedDays: a.lastUsedDays,
      twoFactorEnabled: a.twoFactorEnabled ?? false,
      passwordReused: a.passwordReused ?? false,
      discovered: a.discovered ?? false,
      breachedUnresolved: b !== null,
      breachedPasswordExposed: b?.exposedFields.includes('비밀번호') ?? false,
      // 그 시점 기준 90일 창 안의 이상접속만 계상
      suspiciousRecent: mine.some(
        (l) => l.suspicious && l.daysAgo - snapshotDaysAgo <= SUSPICIOUS_WINDOW_DAYS,
      ),
      accessLogObserved: mine.length > 0,
      removed: cleanupDone,
      passwordChanged: false,
      sessionsCleared: false,
    };
  });
}

export type ProvisionResult = {
  provisioned: boolean; // false = 이미 데이터 보유(멱등 skip)
  accounts: number;
};

export type ProvisionOptions = {
  // id 접두사. 시드 유저는 'seed'(기존 seed-a01… 보존), 실 사용자는 'u<google sub>'.
  idPrefix: string;
  // true면 보유 여부와 무관하게 upsert 재적재(시드 스크립트용 — 상대 시각 갱신).
  // false(기본)면 이미 계정을 가진 사용자는 건드리지 않는다(사용자 데이터 보호).
  force?: boolean;
};

// 한 사용자에게 데모 인벤토리 일습을 적재한다. User 레코드는 호출자가 먼저 보장해야 한다.
export async function provisionDemoData(
  db: PrismaClient,
  userId: string,
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const { idPrefix, force = false } = opts;

  if (!force) {
    const existing = await db.account.count({ where: { userId } });
    if (existing > 0) {
      return { provisioned: false, accounts: existing };
    }
  }

  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  // 24 계정 — 고정 id 멱등 upsert. 전부 source:'seed'(출처 정직 표기 — 실연동 아님).
  for (const a of accounts) {
    const data = {
      userId,
      name: a.service,
      provider: toProvider(a.linkMethod),
      category: a.category,
      source: 'seed' as const,
      lastUsedAt: lastUsedAt(a.lastUsedDays),
      breached: a.breached,
      passwordReused: a.passwordReused ?? false,
      twoFactorEnabled: a.twoFactorEnabled ?? false,
      discovered: a.discovered ?? false,
      riskTags: deriveRiskTags(a),
    };
    await db.account.upsert({
      where: { id: id(a.id) },
      update: { ...data, riskTags: { set: data.riskTags } },
      create: { id: id(a.id), ...data },
    });
  }

  // 유출 이력 — 서비스명으로 계정 매칭(있으면 연결).
  for (const b of breaches) {
    const matched = accounts.find((a) => a.service === b.service);
    const data = {
      userId,
      accountId: matched ? id(matched.id) : null,
      service: b.service,
      breachDate: parseBreachDate(b.breachDate),
      exposedFields: b.exposedFields,
      advice: b.advice,
      severity: b.severity,
      resolved: b.resolved,
    };
    await db.breach.upsert({
      where: { id: id(b.id) },
      update: { ...data, exposedFields: { set: data.exposedFields } },
      create: { id: id(b.id), ...data },
    });
  }

  // 접속기록(이상접속 1 + 정상 4).
  for (const l of ACCESS_LOGS) {
    const data = {
      accountId: id(l.accountKey),
      timestamp: new Date(Date.now() - l.daysAgo * DAY),
      location: l.location,
      device: l.device,
      suspicious: l.suspicious,
    };
    await db.accessLog.upsert({
      where: { id: id(l.key) },
      update: data,
      create: { id: id(l.key), ...data },
    });
  }

  // 정리 요청 4건. 싸이월드 done(어제) = 회복규칙 데모.
  for (const r of deleteRequests) {
    const matched = accounts.find((a) => a.service === r.service);
    if (!matched) continue;
    const status = CLEANUP_STATUS[r.status];
    const data = {
      userId,
      accountId: id(matched.id),
      actionType: CLEANUP_ACTION[r.service] ?? ('delete' as ActionType),
      status,
      completedAt: status === 'done' ? new Date(Date.now() - CLEANUP_DONE_DAYS_AGO * DAY) : null,
    };
    await db.cleanupRequest.upsert({
      where: { id: id(r.id) },
      update: data,
      create: { id: id(r.id), ...data },
    });
  }

  // 점수 스냅샷 이력 — 각 시점 상태를 v2 엔진으로 재계산(하드코딩 아님).
  // axes를 반드시 채운다: axes null 스냅샷은 v1 잔재로 취급돼 purge 대상이었다.
  for (const p of SNAPSHOT_POINTS) {
    const v2 = scoreV2(rowsAt(p.daysAgo));
    const data = {
      userId,
      score: v2.composite ?? 0,
      coverage: v2.coverage,
      coveredCount: v2.axes.surface.coveredCount,
      axes: toAxesSnapshot(v2.axes) as unknown as Prisma.InputJsonValue,
      createdAt: new Date(Date.now() - p.daysAgo * DAY),
    };
    await db.scoreSnapshot.upsert({
      where: { id: id(p.key) },
      update: data,
      create: { id: id(p.key), ...data },
    });
  }

  return { provisioned: true, accounts: accounts.length };
}

// 프로비저닝 결과 정리(검증 스크립트 전용). 사용자 데이터 삭제 경로가 아니다.
// Account·Breach·CleanupRequest·ScoreSnapshot은 User onDelete: Cascade, AccessLog는 Account Cascade.
export async function purgeProvisionedData(db: PrismaClient, userId: string): Promise<void> {
  await db.scoreSnapshot.deleteMany({ where: { userId } });
  await db.cleanupRequest.deleteMany({ where: { userId } });
  await db.breach.deleteMany({ where: { userId } });
  await db.accessLog.deleteMany({ where: { account: { userId } } });
  await db.account.deleteMany({ where: { userId } });
}
