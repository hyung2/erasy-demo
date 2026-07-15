// 점수 엔진 fixture 단위검증(T3.1) — DB 불필요, 순수 계산만.
// 실행: pnpm exec tsx scripts/score-fixture.test.ts
// 검증: (1) 앵커 재현(현 시드 52 / 회복 전 47 / 이상접속 전 50 — score-spec-T3.0 4장)
//       (2) 단조성(신호 추가→하락, 회복→상승) (3) 캡 동작 (4) 0 하한 클램프 (5) coverage.
import assert from 'node:assert/strict';
import {
  computePrivacyScore,
  deriveSignals,
  deriveCoverage,
  type AccountSignalRow,
} from '../lib/score';
import { accounts, breaches, deleteRequests } from '../lib/dummy-data';

// 시드와 동일 규칙으로 dummy → 엔진 행 구성(prisma/seed.ts signalRowAt와 정합)
const SUSPICIOUS_ACCOUNTS = new Set(['a17']); // 뽐뿌 3일 전 이상접속(시드 seed-al-01)

function buildRows(opts: { suspicious: boolean; cleanupDone: boolean }): AccountSignalRow[] {
  return accounts.map((a) => {
    const b = breaches.find((x) => x.service === a.service && !x.resolved) ?? null;
    const removed =
      opts.cleanupDone &&
      deleteRequests.some((r) => r.service === a.service && r.status === '완료');
    return {
      provider:
        a.linkMethod === 'email-password'
          ? ('manual' as const)
          : (a.linkMethod.replace('-oauth', '') as AccountSignalRow['provider']),
      category: a.category,
      lastUsedDays: a.lastUsedDays,
      twoFactorEnabled: a.twoFactorEnabled ?? false,
      passwordReused: a.passwordReused ?? false,
      breachedUnresolved: b !== null,
      breachedPasswordExposed: b?.exposedFields.includes('비밀번호') ?? false,
      suspiciousRecent: opts.suspicious && SUSPICIOUS_ACCOUNTS.has(a.id),
      removed,
      passwordChanged: false,
      sessionsCleared: false,
    };
  });
}

function scoreOf(rows: AccountSignalRow[]): number {
  return computePrivacyScore(deriveSignals(rows), deriveCoverage(rows));
}

// ── 1. 앵커 재현 ──
const current = buildRows({ suspicious: true, cleanupDone: true });
assert.equal(scoreOf(current), 52, '앵커: 현 시드(이상접속+싸이월드 회복) = 52');
assert.equal(
  scoreOf(buildRows({ suspicious: true, cleanupDone: false })),
  47,
  '앵커: 회복 전 = 47',
);
assert.equal(
  scoreOf(buildRows({ suspicious: false, cleanupDone: false })),
  50,
  '앵커: 이상접속 전 = 50',
);

// 신호 분해 검증(계산표 정합)
const sig = deriveSignals(current);
assert.equal(sig.totalAccounts, 24);
assert.equal(sig.breachedCount, 3, 'P1 유출 미해결 3');
assert.equal(sig.breachedPasswordCount, 2, 'P1a 비밀번호 노출 2(Quora·뽐뿌)');
assert.equal(sig.dormantCount, 0, 'P2 0(싸이월드 revoke done 회복)');
assert.equal(sig.staleCount, 4, 'P3 4(카카오스토리·Spotify·Amazon·Medium)');
assert.equal(sig.overseasActiveCount, 2, 'P4 2(Netflix·Notion)');
assert.equal(sig.reusedCount, 6, '재사용 6');
assert.equal(sig.no2faCount, 3, 'manual 2FA 미설정 3(Amazon·인터파크·뽐뿌)');
assert.equal(sig.suspiciousCount, 1, '이상접속 1(뽐뿌)');

// ── 2. 단조성 ──
const base = scoreOf(current);

// 유출 추가 → 하락
const withBreach = current.map((r, i) =>
  i === 0 ? { ...r, breachedUnresolved: true, breachedPasswordExposed: true } : r,
);
assert.ok(scoreOf(withBreach) < base, '유출 추가 시 점수 하락');

// 유출 해결(뽐뿌) → 상승
const resolved = current.map((r) =>
  r.breachedUnresolved && r.suspiciousRecent ? { ...r, breachedUnresolved: false } : r,
);
assert.ok(scoreOf(resolved) > base, '유출 해결 시 점수 상승');

// 회복: password_change → 재사용 가산 해제 → 상승 또는 동일(캡 하에서)
const pwChanged = current.map((r) => ({ ...r, passwordChanged: true }));
assert.ok(scoreOf(pwChanged) >= base, '비밀번호 교체 시 하락 없음');
assert.ok(scoreOf(pwChanged) > base, '재사용 6건 전체 교체 시 상승');

// ── 3. 캡 동작: 재사용 6건(12점 상당)이 캡 8로 제한 → 1건 더 추가해도 무변화 ──
const moreReuse = current.map((r, i) =>
  i === 1 ? { ...r, passwordReused: true } : r,
);
assert.equal(scoreOf(moreReuse), base, '재사용 캡 초과분은 무변화');

// ── 4. 클램프: 극단 신호 → 하한 0 ──
const worst: AccountSignalRow[] = Array.from({ length: 20 }, () => ({
  provider: 'manual' as const,
  category: 'overseas' as const,
  lastUsedDays: 1000,
  twoFactorEnabled: false,
  passwordReused: true,
  breachedUnresolved: true,
  breachedPasswordExposed: true,
  suspiciousRecent: true,
  removed: false,
  passwordChanged: false,
  sessionsCleared: false,
}));
assert.equal(scoreOf(worst), 0, '극단 신호는 0으로 클램프');

// ── 5. coverage: 시드 전량 확인 = 1.0 / lastUsedAt 미상 → 하락 + 무감점 ──
const cov = deriveCoverage(current);
assert.equal(cov.coverage, 1, '시드 coverage 1.0');
assert.equal(cov.coveredCount, 24);

const withUnknown = [...current, {
  provider: 'manual' as const,
  category: 'domestic' as const,
  lastUsedDays: null,
  twoFactorEnabled: true,
  passwordReused: false,
  breachedUnresolved: false,
  breachedPasswordExposed: false,
  suspiciousRecent: false,
  removed: false,
  passwordChanged: false,
  sessionsCleared: false,
}];
assert.ok(deriveCoverage(withUnknown).coverage < 1, '미확인 계정은 coverage 하락');
assert.equal(scoreOf(withUnknown), base, '미확인 계정은 무감점(정직 표기)');

console.log('score-fixture: 15 assertions passed — anchor 52 / pre-recovery 47 / pre-suspicious 50');
