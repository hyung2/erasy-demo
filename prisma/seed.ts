// Prisma 시드(T2.2 코드분 + T3.2 점수 신호 보강) — dummy-data 24계정을 source:'seed'로 DB 적재.
// 멱등: 고정 id upsert(재실행해도 drift 없음). 실행: `pnpm db:seed`.
// 자격증명 미저장 원칙 준수 — 비번/해시 없음. 점수 신호는 전부 메타(불리언·타임스탬프)만.
// 신호 정본: 03-step02-mvp/score-spec-T3.0.md 3장(재사용 6 · 2FA 4 · 이상접속 1 · discovered 3).
import { PrismaClient } from '@prisma/client';
import type { Provider, RiskTag, ActionType, CleanupStatus } from '@prisma/client';
import {
  accounts,
  breaches,
  deleteRequests,
  DEMO_USER_ID,
  type Account as DummyAccount,
  type LinkMethod,
} from '../lib/dummy-data';
import {
  computePrivacyScore,
  deriveSignals,
  deriveCoverage,
  type AccountSignalRow,
} from '../lib/score';

const prisma = new PrismaClient();

const DEMO_USER_EMAIL = 'demo@erasy.app';
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

// ── 접속기록 시드(고정 id 멱등) — 이상접속 1건(뽐뿌 a17, 3일 전, 위치 미상) + 정상 4건 ──
const ACCESS_LOGS: Array<{
  id: string;
  accountKey: string; // dummy id (a17 등)
  daysAgo: number;
  location: string;
  device: string;
  suspicious: boolean;
}> = [
  { id: 'seed-al-01', accountKey: 'a17', daysAgo: 3, location: '미상', device: 'Unknown', suspicious: true },
  { id: 'seed-al-02', accountKey: 'a17', daysAgo: 600, location: '서울, KR', device: 'Chrome / Windows', suspicious: false },
  { id: 'seed-al-03', accountKey: 'a19', daysAgo: 0, location: '서울, KR', device: 'Chrome / Windows', suspicious: false },
  { id: 'seed-al-04', accountKey: 'a01', daysAgo: 0, location: '서울, KR', device: 'Chrome / Windows', suspicious: false },
  { id: 'seed-al-05', accountKey: 'a15', daysAgo: 420, location: '서울, KR', device: 'Safari / macOS', suspicious: false },
];

// ── 정리 요청 시드 — dummy deleteRequests 정합(싸이월드 revoke done = 회복규칙 실증) ──
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

// ── 스냅샷 이력 — 임의값 금지: 각 시점 상태를 엔진으로 재계산(score-spec-T3.0 4.2) ──
// 8일 전 = 이상접속 발생 전·정리 전(기대 50) / 3일 전 = 이상접속 반영(기대 47).
// 단순화: 이벤트 신호(이상접속·정리)만 시점 차등, 휴면 일수는 현재 기준 고정(경계 드리프트 배제).
function signalRowAt(
  a: DummyAccount,
  opts: { suspicious: boolean; cleanupDone: boolean },
): AccountSignalRow {
  const b = unresolvedBreachOf(a.service);
  const doneReq =
    opts.cleanupDone &&
    deleteRequests.some((r) => r.service === a.service && r.status === '완료');
  return {
    provider: toProvider(a.linkMethod),
    category: a.category,
    lastUsedDays: a.lastUsedDays,
    twoFactorEnabled: a.twoFactorEnabled ?? false,
    passwordReused: a.passwordReused ?? false,
    breachedUnresolved: b !== null,
    breachedPasswordExposed: b?.exposedFields.includes('비밀번호') ?? false,
    suspiciousRecent:
      opts.suspicious &&
      ACCESS_LOGS.some((l) => l.accountKey === a.id && l.suspicious && l.daysAgo <= 90),
    removed: doneReq,
    passwordChanged: false,
    sessionsCleared: false,
  };
}

function historicScore(opts: { suspicious: boolean; cleanupDone: boolean }): number {
  const rows = accounts.map((a) => signalRowAt(a, opts));
  return computePrivacyScore(deriveSignals(rows), deriveCoverage(rows));
}

async function main() {
  // 데모 사용자(멱등). 실 로그인 사용자와 구분되는 시드 계정.
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: { email: DEMO_USER_EMAIL, name: '김민준' },
    create: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: '김민준' },
  });

  // 24 계정 — 고정 id `seed-a01`… 멱등 upsert. 전부 source:'seed'. 점수 신호 포함.
  for (const a of accounts) {
    const id = `seed-${a.id}`;
    const data = {
      userId: DEMO_USER_ID,
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
    await prisma.account.upsert({
      where: { id },
      update: { ...data, riskTags: { set: data.riskTags } },
      create: { id, ...data },
    });
  }

  // 유출 이력 — 서비스명으로 계정 매칭(있으면 연결). 고정 id 멱등 upsert.
  for (const b of breaches) {
    const id = `seed-${b.id}`;
    const matched = accounts.find((a) => a.service === b.service);
    const accountId = matched ? `seed-${matched.id}` : null;
    const data = {
      userId: DEMO_USER_ID,
      accountId,
      service: b.service,
      breachDate: parseBreachDate(b.breachDate),
      exposedFields: b.exposedFields,
      advice: b.advice,
      severity: b.severity,
      resolved: b.resolved,
    };
    await prisma.breach.upsert({
      where: { id },
      update: { ...data, exposedFields: { set: data.exposedFields } },
      create: { id, ...data },
    });
  }

  // 접속기록 — 고정 id 멱등 upsert(이상접속 1 + 정상 4).
  for (const l of ACCESS_LOGS) {
    const data = {
      accountId: `seed-${l.accountKey}`,
      timestamp: new Date(Date.now() - l.daysAgo * DAY),
      location: l.location,
      device: l.device,
      suspicious: l.suspicious,
    };
    await prisma.accessLog.upsert({
      where: { id: l.id },
      update: data,
      create: { id: l.id, ...data },
    });
  }

  // 정리 요청 — dummy deleteRequests 4건 정합. 싸이월드 done(어제) = 회복규칙 데모.
  for (const r of deleteRequests) {
    const matched = accounts.find((a) => a.service === r.service);
    if (!matched) continue;
    const id = `seed-${r.id}`;
    const status = CLEANUP_STATUS[r.status];
    const data = {
      userId: DEMO_USER_ID,
      accountId: `seed-${matched.id}`,
      actionType: CLEANUP_ACTION[r.service] ?? ('delete' as ActionType),
      status,
      completedAt: status === 'done' ? new Date(Date.now() - 1 * DAY) : null,
    };
    await prisma.cleanupRequest.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  // 점수 스냅샷 이력 2건 — 각 시점 상태의 엔진 재계산값(하드코딩 아님).
  const cov = deriveCoverage(accounts.map((a) => signalRowAt(a, { suspicious: true, cleanupDone: true })));
  const SNAPSHOTS = [
    { id: 'seed-ss-01', daysAgo: 8, score: historicScore({ suspicious: false, cleanupDone: false }) },
    { id: 'seed-ss-02', daysAgo: 3, score: historicScore({ suspicious: true, cleanupDone: false }) },
  ];
  for (const s of SNAPSHOTS) {
    const data = {
      userId: DEMO_USER_ID,
      score: s.score,
      coverage: cov.coverage,
      coveredCount: cov.coveredCount,
      createdAt: new Date(Date.now() - s.daysAgo * DAY),
    };
    await prisma.scoreSnapshot.upsert({
      where: { id: s.id },
      update: data,
      create: { id: s.id, ...data },
    });
  }

  console.log(
    `seed done: user=${DEMO_USER_ID}, accounts=${accounts.length}, breaches=${breaches.length}, ` +
      `accessLogs=${ACCESS_LOGS.length}, cleanups=${deleteRequests.length}, ` +
      `snapshots=[${SNAPSHOTS.map((s) => s.score).join(',')}]`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
