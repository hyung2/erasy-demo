// 유출 대조 회귀 가드 — 순수 함수 구간(DB·네트워크 없음).
//
// 실행: pnpm exec tsx scripts/verify-breach-lookup.ts
//
// 무엇을 지키는가
//  (1) HIBP 응답 → Breach 정규화가 **점수 엔진과의 계약**을 지키는지.
//      'Passwords' → '비밀번호' 한 줄이 어긋나면 유출 사건의 계수가 0.35에서 0.2로
//      조용히 내려간다. 화면도 로그도 아무 말을 하지 않는다.
//  (2) E축이 "대조하지 않았으면 만점을 주지 않는다"를 지키는지. 2026-08-21 이전에는
//      계정만 있으면 100점이었고 그게 종합의 35%를 떠받쳤다.
import assert from 'node:assert/strict';
import {
  normalize,
  keepAsAccountBreach,
  decideSeverity,
  toKoreanFields,
  type HibpBreach,
} from '../lib/hibp-breaches';
import { computeExposure, type ScoreRowV2 } from '../lib/score-v2';

let passed = 0;
function check(cond: boolean, msg: string): void {
  assert.ok(cond, msg);
  passed += 1;
}
function eq<T>(a: T, b: T, msg: string): void {
  assert.equal(a, b, `${msg} (got ${String(a)}, want ${String(b)})`);
  passed += 1;
}

function hibp(over: Partial<HibpBreach> = {}): HibpBreach {
  return {
    Name: 'Adobe',
    Title: 'Adobe',
    Domain: 'adobe.com',
    BreachDate: '2013-10-04',
    DataClasses: ['Email addresses', 'Passwords', 'Usernames'],
    IsVerified: true,
    IsSpamList: false,
    IsMalware: false,
    ...over,
  };
}

// ── 1. 필드 한글화 — 엔진 계약 ──
{
  const f = toKoreanFields(['Email addresses', 'Passwords']);
  check(f.includes('비밀번호'), "1-a 'Passwords' → '비밀번호' (E축 계수 계약)");
  check(f.includes('이메일'), '1-b Email addresses → 이메일');

  // 사전에 없는 값은 지어내지 않고 원문을 둔다.
  eq(toKoreanFields(['Fictional Class'])[0], 'Fictional Class', '1-c 미등록 값은 원문 보존');
}

// ── 2. 심각도 ──
{
  eq(decideSeverity(['이메일', '비밀번호']), 'high', '2-a 비밀번호 유출 = high');
  eq(decideSeverity(['이메일', '신용카드']), 'high', '2-b 되돌리기 어려운 항목 = high');
  eq(decideSeverity(['이메일']), 'low', '2-c 이메일 단독 = low');
  eq(decideSeverity(['이메일', '이름', '전화번호']), 'mid', '2-d 복수 PII = mid');
}

// ── 3. 계정 유출로 볼 사건만 남긴다 ──
{
  check(keepAsAccountBreach(hibp()), '3-a 검증된 사건은 통과');
  check(
    !keepAsAccountBreach(hibp({ IsSpamList: true })),
    '3-b 스팸 목록 제외 — 명단에 있는 것이지 계정이 뚫린 게 아니다',
  );
  check(!keepAsAccountBreach(hibp({ IsMalware: true })), '3-c 악성코드 수집본 제외');
  check(
    !keepAsAccountBreach(hibp({ IsVerified: false })),
    '3-d 미검증 사건 제외 — 확증 없는 건으로 점수를 깎지 않는다',
  );
}

// ── 4. 정규화 ──
{
  const n = normalize(hibp());
  eq(n.service, 'Adobe', '4-a Title이 표시명');
  eq(n.domain, 'adobe.com', '4-b 도메인 소문자 보존(계정 매칭 키)');
  eq(n.breachDate.toISOString().slice(0, 10), '2013-10-04', '4-c 날짜가 하루 밀리지 않음');
  eq(n.severity, 'high', '4-d 비밀번호 포함 → high');
  check(n.advice.includes('비밀번호'), '4-e 조치 안내가 실제 행동을 지정');

  // Title이 비면 Name으로 떨어진다 — 이름 없는 카드가 화면에 뜨지 않게.
  eq(normalize(hibp({ Title: '' })).service, 'Adobe', '4-f Title 공백 시 Name 사용');
}

// ── 5. E축: 대조하지 않았으면 측정하지 않는다 ──
{
  const row = (over: Partial<ScoreRowV2> = {}): ScoreRowV2 =>
    ({
      removed: false,
      breachedUnresolved: false,
      breachedPasswordExposed: false,
      ...over,
    }) as ScoreRowV2;

  const clean = [row(), row(), row()];

  const unchecked = computeExposure(clean);
  eq(unchecked.measured, false, '5-a 대조 전 = 미측정');
  eq(unchecked.score, null, '5-b 대조 전에는 점수를 내지 않는다 (이전에는 100이었다)');
  eq(unchecked.coverage, 0, '5-c 대조 전 coverage 0');

  const checked = computeExposure(clean, { checked: true });
  eq(checked.measured, true, '5-d 대조 후 = 측정됨');
  eq(checked.score, 100, '5-e 대조했는데 유출 0건 = 100 (이건 근거 있는 만점이다)');
  eq(checked.coverage, 1, '5-f 대조 후 coverage 1');

  // 인자를 빠뜨린 호출은 미측정으로 떨어진다 — 기본값이 안전 쪽이어야
  // 새 호출부가 생길 때 조용히 만점이 부활하지 않는다.
  eq(computeExposure(clean, {}).measured, false, '5-g 빈 옵션도 미측정(기본값 안전)');
}

// ── 6. E축: 유출 종류에 따른 감점 ──
{
  const row = (over: Partial<ScoreRowV2>): ScoreRowV2 =>
    ({ removed: false, breachedUnresolved: false, breachedPasswordExposed: false, ...over }) as ScoreRowV2;

  const pwd = computeExposure(
    [row({ breachedUnresolved: true, breachedPasswordExposed: true })],
    { checked: true },
  );
  eq(pwd.score, 65, '6-a 비밀번호 유출 1건 = 100 × (1 − 0.35)');

  const pii = computeExposure([row({ breachedUnresolved: true })], { checked: true });
  eq(pii.score, 80, '6-b PII만 유출 1건 = 100 × (1 − 0.2)');

  // 정리한 계정은 감점 대상에서 빠진다(회복 규칙 removed).
  const removed = computeExposure(
    [row({ breachedUnresolved: true, breachedPasswordExposed: true, removed: true })],
    { checked: true },
  );
  eq(removed.score, 100, '6-c 제거한 계정의 유출은 세지 않는다');

  // 조치 완료(resolved=true → breachedUnresolved=false)도 마찬가지.
  eq(
    computeExposure([row({ breachedUnresolved: false })], { checked: true }).score,
    100,
    '6-d 조치 완료 건은 감점 해제 — 회복 경로가 살아 있다',
  );
}

console.log(`verify-breach-lookup: ${passed} assertions passed`);
console.log('  E축은 이제 대조를 실제로 수행한 사용자에게만 점수를 낸다.');
