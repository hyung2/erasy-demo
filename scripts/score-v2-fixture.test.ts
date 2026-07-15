// 점수 엔진 v2 fixture 단위검증(T4.2) — DB 불필요, 순수 계산만.
// 실행: npx tsx scripts/score-v2-fixture.test.ts
// 기대값 출처: 투명설계안 v2 완전 워크스루(옵시디언, 김민준 전 숫자 검산).
// 검증: (1) 앵커 종합 24 + 축[34,66,9,60] + trend[27,23,24]
//       (2) 회복 계단 6값 24→46→71→77→84→93
//       (3) 블렌드 성질 3종(마스킹 차단 / 합의 보존 / 전축 100)
//       (4) C2 단조성 3종(2FA manual 삭제→H 불하락 / 재사용 교체→H 상승 / expectedGain≥0)
//       (5) M3 분모 0 재정규화(manualAccounts=0 / passwordHolders=0)
import assert from 'node:assert/strict';
import {
  scoreV2,
  computeAxes,
  computeComposite,
  computeHygiene,
  computeThreat,
  blend,
  applyAction,
  deriveGrade,
  type ScoreRowV2,
  type AxisScore,
} from '../lib/score-v2';
import { accounts, breaches, deleteRequests } from '../lib/dummy-data';
import { projectRecovery } from '../lib/score-projection';

let passed = 0;
function check(cond: boolean, msg: string): void {
  assert.ok(cond, msg);
  passed += 1;
}
function eq<T>(a: T, b: T, msg: string): void {
  assert.equal(a, b, `${msg} (got ${String(a)}, want ${String(b)})`);
  passed += 1;
}

// ── 시드 → v2 엔진 행 구성(dummy-data 신호 그대로, 워크스루 전제) ──
// 이상접속: 뽐뿌(a17). 접속기록 관측 5/24(시드 coverage). 싸이월드 revoke done.
const SUSPICIOUS = new Set(['a17']);
const ACCESS_OBSERVED = new Set(['a17', 'a01', 'a05', 'a08', 'a19']); // 5/24

function baseRows(): ScoreRowV2[] {
  return accounts.map((a) => {
    const b = breaches.find((x) => x.service === a.service && !x.resolved) ?? null;
    const removed = deleteRequests.some(
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
      discovered: a.discovered ?? false,
      breachedUnresolved: b !== null,
      breachedPasswordExposed: b?.exposedFields.includes('비밀번호') ?? false,
      suspiciousRecent: SUSPICIOUS.has(a.id),
      accessLogObserved: ACCESS_OBSERVED.has(a.id),
      removed,
      passwordChanged: false,
      sessionsCleared: false,
    };
  });
}
const idx = (id: string) => accounts.findIndex((a) => a.id === id);
const r2 = (x: number) => Math.round(x * 100) / 100; // 소수 2자리(검산 표기용)

// ══════════════════════════════════════════════════════════════════
// 1. 앵커 재현 — 종합 24(위험) + 축[34,66,9,60]
// ══════════════════════════════════════════════════════════════════
const anchor = baseRows();
const res = scoreV2(anchor);
const ax = res.axes;

eq(res.composite, 24, '앵커 종합 = 24');
eq(res.grade, '위험', '앵커 등급 = 위험');
eq(res.measured, true, '앵커 측정됨');
eq(res.weakestAxis, 'hygiene', '최약축 = hygiene');

// 축 raw 검산(표시 round 전 정확값) + 표시값[34,66,9,60]
eq(r2(ax.exposure.score as number), 33.8, 'E raw = 33.8');
eq(r2(ax.surface.score as number), 66.43, 'S raw = 66.43');
eq(r2(ax.hygiene.score as number), 8.75, 'H raw = 8.75');
eq(ax.threat.score as number, 60, 'T raw = 60');
eq(Math.round(ax.exposure.score as number), 34, 'E 표시 = 34');
eq(Math.round(ax.surface.score as number), 66, 'S 표시 = 66');
eq(Math.round(ax.hygiene.score as number), 9, 'H 표시 = 9');
eq(Math.round(ax.threat.score as number), 60, 'T 표시 = 60');

// 4축 전부 측정됨 + 추천 액션 = 비밀번호 교체([C2] hygiene 고정)
check(
  ax.exposure.measured && ax.surface.measured && ax.hygiene.measured && ax.threat.measured,
  '앵커 4축 전부 측정됨',
);
eq(res.recommendedAction?.actionType, 'password_change', '추천 = 비밀번호 교체');

// 스냅샷 이력 trend [27, 23, 24] (워크스루 12.4)
const snap8d = baseRows().map((r) => ({ ...r, suspiciousRecent: false, removed: false }));
// 8일 전: 싸이월드 미회복(removed 해제) + 이상접속 없음
const snap8dRestored = baseRows().map((r, i) =>
  i === idx('a18') ? { ...r, removed: false } : { ...r, suspiciousRecent: false },
);
const snap3d = baseRows().map((r, i) =>
  i === idx('a18') ? { ...r, removed: false } : r,
); // 3일 전: 뽐뿌 이상접속 O, 싸이월드 미회복
void snap8d;
eq(computeComposite(snap8dRestored), 27, '스냅샷 8일 전 = 27');
eq(computeComposite(snap3d), 23, '스냅샷 3일 전 = 23');
eq(res.composite, 24, '스냅샷 현재 = 24');

// ══════════════════════════════════════════════════════════════════
// 2. 회복 계단 6값 — 24→46→71→77→84→93 (워크스루 12.5)
// ══════════════════════════════════════════════════════════════════
const s0 = anchor;
// 1: 재사용 6계정 비밀번호 교체
const s1 = applyAction(s0, 'password_change');
// 2: 유출 3건 해결
const s2 = applyAction(s1, 'resolve_breach');
// 3: 뽐뿌 세션 정리
const s3 = applyAction(s2, 'logout_sessions');
// 4: Quora·뽐뿌·Medium delete + 카카오스토리 revoke
const s4targets = [idx('a15'), idx('a17'), idx('a14'), idx('a07')];
const s4 = applyAction(s3, 'delete', s4targets);
// 5: Amazon·인터파크 2FA 설정
const s5 = applyAction(s4, 'enable_2fa', [idx('a12'), idx('a16')]);

const ladder = [s0, s1, s2, s3, s4, s5].map((s) => computeComposite(s));
eq(ladder[0], 24, '계단0(진단) = 24');
eq(ladder[1], 46, '계단1(비번교체) = 46');
eq(ladder[2], 71, '계단2(유출해결) = 71');
eq(ladder[3], 77, '계단3(세션정리) = 77');
eq(ladder[4], 84, '계단4(방치삭제) = 84');
eq(ladder[5], 93, '계단5(2FA설정) = 93');

// 계단은 단조 비하락
for (let i = 1; i < ladder.length; i++) {
  check((ladder[i] as number) >= (ladder[i - 1] as number), `계단 ${i} 비하락`);
}

// 계단 delta 순서 검증: 유출해결(+25)·비번교체(+22) ≫ 나머지(+6~9)
const deltas = ladder.slice(1).map((v, i) => (v as number) - (ladder[i] as number));
eq(deltas[0], 22, 'delta 비번교체 = +22');
eq(deltas[1], 25, 'delta 유출해결 = +25');
check(
  Math.min(deltas[0], deltas[1]) > Math.max(deltas[2], deltas[3], deltas[4]),
  'delta: 유출·비번 레버가 나머지보다 큼(위협 서열 정합)',
);

// expectedGain(앵커 상태 비번교체) = 계단1 delta = +22
const egPw = res.expectedGains.find((e) => e.actionType === 'password_change');
eq(egPw?.expectedGain, 22, 'expectedGain(비번교체) = +22');

// ══════════════════════════════════════════════════════════════════
// 3. 블렌드 성질 3종 (합성 축값으로 수학 성질 직접 검증)
// ══════════════════════════════════════════════════════════════════
function synthAxis(key: AxisScore['key'], score: number): AxisScore {
  return { key, score, measured: true, coveredCount: 1, totalCount: 1, coverage: 1, topFinding: null };
}
const AKEYS: AxisScore['key'][] = ['exposure', 'surface', 'hygiene', 'threat'];

// 3-1. 마스킹 차단: 임의 한 축=0, 나머지 100 → 항상 위험(<50)
for (const zero of AKEYS) {
  const b = blend(AKEYS.map((k) => synthAxis(k, k === zero ? 0 : 100)));
  check(
    (b.composite as number) < 50,
    `마스킹 차단: ${zero}=0 → 종합 ${b.composite} < 50(위험)`,
  );
}
// 최저가중(threat) 축 0일 때가 상한 — 46.75→47 (SSOT 5.3-1)
const maskBound = blend(AKEYS.map((k) => synthAxis(k, k === 'threat' ? 0 : 100)));
eq(maskBound.composite, 47, '마스킹 상한(threat=0, 나머지 100) = 47');

// 3-2. 합의 보존: 전 축 동일 x → 종합 x (블렌드 항등)
for (const x of [37, 55, 72, 88]) {
  const b = blend(AKEYS.map((k) => synthAxis(k, x)));
  eq(b.composite, x, `합의 보존: 전축 ${x} → 종합 ${x}`);
}
// 3-3. 전축 100 → 100
eq(blend(AKEYS.map((k) => synthAxis(k, 100))).composite, 100, '전축 100 → 종합 100');

// 3-4. 가중평균 단독보다 낮거나 같음(최약축 끌어내림) — 앵커로 검증
{
  const P = { exposure: 0.35, hygiene: 0.3, surface: 0.2, threat: 0.15 };
  const wa =
    P.exposure * (ax.exposure.score as number) +
    P.surface * (ax.surface.score as number) +
    P.hygiene * (ax.hygiene.score as number) +
    P.threat * (ax.threat.score as number);
  check((res.composite as number) <= Math.round(wa), '종합 ≤ 가중평균(최약축 지배)');
}

// ══════════════════════════════════════════════════════════════════
// 4. C2 단조성 3종
// ══════════════════════════════════════════════════════════════════
// 4-1. 2FA manual 계정 삭제 → H 불하락 (중립 처리 검증)
//   토스(a22) = 유일한 2FA manual 계정. 삭제해도 H 유지(안전 계정 신용 유지).
{
  const hBefore = computeHygiene(anchor).score as number;
  const delTfa = applyAction(anchor, 'delete', [idx('a22')]);
  const hAfter = computeHygiene(delTfa).score as number;
  check(hAfter >= hBefore - 1e-9, `2FA manual 삭제 → H 불하락 (${r2(hBefore)}→${r2(hAfter)})`);
  // 종합 expectedGain도 음수 아님
  const compBefore = computeComposite(anchor) as number;
  const compAfter = computeComposite(delTfa) as number;
  check(compAfter >= compBefore, '2FA manual 삭제 → 종합 비하락');
}

// 4-2. 재사용 계정 password_change → H 상승
{
  const hBefore = computeHygiene(anchor).score as number;
  const pw = applyAction(anchor, 'password_change');
  const hAfter = computeHygiene(pw).score as number;
  check(hAfter > hBefore, `재사용 교체 → H 상승 (${r2(hBefore)}→${r2(hAfter)})`);
}

// 4-3. 모든 회복 액션 expectedGain ≥ 0 (앵커 + 계단 각 상태에서)
for (const [label, state] of [
  ['앵커', s0],
  ['계단1', s1],
  ['계단2', s2],
  ['계단3', s3],
  ['계단4', s4],
] as const) {
  const eg = scoreV2(state).expectedGains;
  for (const e of eg) {
    check(e.expectedGain >= 0, `${label} expectedGain(${e.actionType}) ≥ 0`);
  }
}
// 임의 계정 삭제(2FA 포함) 순회 — 어떤 단일 삭제도 종합 비하락([C2] clamp+중립)
for (let i = 0; i < anchor.length; i++) {
  const before = computeComposite(anchor) as number;
  const after = computeComposite(applyAction(anchor, 'delete', [i])) as number;
  check(after >= before, `계정 ${accounts[i].id} 삭제 → 종합 비하락`);
}

// ══════════════════════════════════════════════════════════════════
// 5. M3 분모 0 재정규화 (크래시 없음)
// ══════════════════════════════════════════════════════════════════
function row(over: Partial<ScoreRowV2>): ScoreRowV2 {
  return {
    provider: 'google',
    category: 'domestic',
    lastUsedDays: 10,
    twoFactorEnabled: false,
    passwordReused: false,
    discovered: false,
    breachedUnresolved: false,
    breachedPasswordExposed: false,
    suspiciousRecent: false,
    accessLogObserved: false,
    removed: false,
    passwordChanged: false,
    sessionsCleared: false,
    ...over,
  };
}

// 5-1. manualAccounts=0, holders>0(OAuth 재사용) → H = 100×(1−reuseRate), 크래시 없음
{
  const rows = [
    row({ provider: 'google', passwordReused: true }),
    row({ provider: 'naver', passwordReused: true }),
    row({ provider: 'kakao', passwordReused: false }),
  ];
  const h = computeHygiene(rows);
  check(h.measured, 'M3 manual=0: H 측정됨(재사용 항 단독)');
  // holders = 재사용 2 + (kakao는 비보유) → holdersDenom 2, reuseRate 1.0 → H=0
  eq(r2(h.score as number), 0, 'M3 manual=0: H = 100×(1−1.0) = 0');
  check(computeComposite(rows) !== null, 'M3 manual=0: 종합 산출(크래시 없음)');
}

// 5-2. passwordHolders=0(manual·재사용·교체 전무) → H 미측정, 재정규화
{
  const rows = [
    row({ provider: 'google' }),
    row({ provider: 'kakao', breachedUnresolved: true, breachedPasswordExposed: true }),
    row({ provider: 'naver', accessLogObserved: true, suspiciousRecent: true }),
  ];
  const h = computeHygiene(rows);
  eq(h.measured, false, 'M3 holders=0: H 미측정');
  eq(h.score, null, 'M3 holders=0: H score = null');
  const comp = computeComposite(rows);
  check(comp !== null, 'M3 holders=0: 종합 재정규화 산출(H 제외)');
  // 측정 축 E·S·T만으로 블렌드 — 크래시 없음 확인
  const b = blend([
    computeAxes(rows).exposure,
    computeAxes(rows).surface,
    computeAxes(rows).hygiene,
    computeAxes(rows).threat,
  ]);
  eq(b.measured, true, 'M3 holders=0: 3축 재정규화 측정됨');
}

// 5-3. 계정 0개 → 측정 불가(null, 0점 아님)
{
  const empty = scoreV2([]);
  eq(empty.composite, null, '계정 0: 종합 null(측정 불가)');
  eq(empty.measured, false, '계정 0: measured false');
  eq(empty.grade, null, '계정 0: grade null');
}

// 5-4. 접속기록 관측 0 → threat 미측정
{
  const rows = anchor.map((r) => ({ ...r, accessLogObserved: false }));
  eq(computeThreat(rows).measured, false, '관측 0: threat 미측정');
  check(computeComposite(rows) !== null, '관측 0: 종합 재정규화 산출(T 제외)');
}

// ══════════════════════════════════════════════════════════════════
// 6. 회복 투영 정합 — projectRecovery(결과 화면·dashboard cleaned·slide 3곳 통일)
//    B1 회귀 방지: before=24(앵커), after=93(계단 최종). delete 전삭제(→100) 재발 차단.
// ══════════════════════════════════════════════════════════════════
{
  const proj = projectRecovery();
  eq(proj.beforeComposite, 24, '투영 before = 24(앵커 정합)');
  eq(proj.afterComposite, 93, '투영 after = 93(계단 최종)');
  // 축 before 앵커 정합(투영 입력이 fixture 앵커와 동일 궤적)
  eq(Math.round(proj.beforeAxes.hygiene.score as number), 9, '투영 before H = 9');
  eq(Math.round(proj.beforeAxes.threat.score as number), 60, '투영 before T = 60(관측 세팅 정합)');
  // 회복 후 전 축 상승(비하락)
  for (const k of proj.axisKeys) {
    const b = proj.beforeAxes[k];
    const a = proj.afterAxes[k];
    if (b.measured && a.measured && b.score !== null && a.score !== null) {
      check((a.score as number) >= (b.score as number), `투영 ${k} 축 비하락`);
    }
  }
}

// ── 멱등: 2회 실행 drift 0 ──
eq(computeComposite(baseRows()), computeComposite(baseRows()), '멱등: 2회 실행 동일');
eq(deriveGrade(24), '위험', 'deriveGrade(24) = 위험');

console.log(`score-v2-fixture: ${passed} assertions passed`);
console.log(`  앵커 종합 24(위험) · 축 raw [${r2(ax.exposure.score as number)}, ${r2(ax.surface.score as number)}, ${r2(ax.hygiene.score as number)}, ${ax.threat.score}]`);
console.log(`  회복 계단 [${ladder.join(' → ')}]`);
console.log(`  trend [27, 23, 24] · 마스킹 상한 47 · C2 중립처리 · M3 재정규화`);
