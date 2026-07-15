// 피싱 목록 유틸 단위검증(T5.5) — DB·네트워크 불필요.
// 실행: pnpm exec tsx scripts/phishing-list.test.ts
// 검증: (1) 도메인 정규화(scheme·www·path·포트·case) (2) 알려진 등재 도메인 1건 lookup
//       (3) 미등재·매칭 0건 정직 (4) checkDomains 라벨 강제 (5) 실 축약본 로드 크래시 없음.
import assert from 'node:assert/strict';
import {
  normalizeDomain,
  isListed,
  checkDomains,
  loadPhishingDomains,
  phishingListCount,
  PHISHING_LIST_META,
} from '../lib/phishing-list';

let passed = 0;
function eq<T>(a: T, b: T, msg: string): void {
  assert.equal(a, b, `${msg} (got ${String(a)}, want ${String(b)})`);
  passed += 1;
}
function ok(c: boolean, msg: string): void {
  assert.ok(c, msg);
  passed += 1;
}

// ── 1. 정규화 ──
eq(normalizeDomain('https://www.Evil.KR/login?next=1'), 'evil.kr', 'scheme+www+path+case 제거');
eq(normalizeDomain('http://bad.example.com:8080/a'), 'bad.example.com', '포트+path 제거');
eq(normalizeDomain('user@phish.co.kr'), 'phish.co.kr', 'userinfo 제거');
eq(normalizeDomain('Good.KR.'), 'good.kr', '트레일링 점+case');
eq(normalizeDomain('  spaced.kr  '), 'spaced.kr', '공백 트림');
eq(normalizeDomain(''), null, '빈 문자열 → null');
eq(normalizeDomain('http://'), null, '호스트 없음 → null');

// ── 2. 알려진 등재 도메인 1건 lookup (주입 목록으로 매칭 로직 검증) ──
const fixtureSet = new Set(['known-phish.kr', 'evil.example.com']);
ok(isListed('http://known-phish.kr/steal', fixtureSet), '등재 도메인 lookup = true');
ok(isListed('KNOWN-PHISH.KR', fixtureSet), '대소문자 무관 등재 매칭');
ok(isListed('https://www.evil.example.com/x', fixtureSet), 'www+scheme 정규화 후 등재 매칭');

// ── 3. 미등재·매칭 0건 정직 ──
ok(!isListed('naver.com', fixtureSet), '미등재 도메인 = false');
ok(!isListed('sub.known-phish.kr', fixtureSet), '서브도메인은 정확 일치 아님 → 미등재(정직)');
ok(!isListed('', fixtureSet), '빈 입력 = false');

// ── 4. checkDomains: 라벨·기준일 강제 + 매칭만 반환 ──
// (모듈 실 목록은 미적재라 0건 예상 — 억지 매칭 없음)
const seedLike = ['gmail.com', 'quora.com', 'ppomppu.co.kr', 'naver.com'];
const findings = checkDomains(seedLike);
eq(findings.length, 0, '시드 도메인 매칭 0건(실 목록 미적재 — 정직)');
// 라벨 강제 상수 검증
eq(PHISHING_LIST_META.label, '참고 신호 (2023 기준 데이터)', '강제 라벨 문구');
eq(PHISHING_LIST_META.scoreImpact, 'none', '점수 미반영 명시');
eq(PHISHING_LIST_META.baseline, '2023-12-31', '데이터 기준일');

// ── 5. 실 축약본 로드 크래시 없음 + dedup ──
const set = loadPhishingDomains();
ok(set instanceof Set, '축약본 로드 → Set');
eq(phishingListCount(), set.size, 'count = set 크기(캐시 일관)');
ok(phishingListCount() >= 0, '카운트 ≥ 0 (미적재면 0)');

console.log(`phishing-list: ${passed} assertions passed`);
console.log(`  실 축약본 등재 도메인 ${phishingListCount()}개 (미적재 시 0 = 매칭 0건 정직)`);
console.log(`  라벨 강제: "${PHISHING_LIST_META.label}" · 점수영향 ${PHISHING_LIST_META.scoreImpact}`);
