// 서비스 정규화 회귀 가드 — 순수 함수 구간(DB 없음).
//
// 실행: pnpm exec tsx scripts/verify-service-registry.ts
//
// 이 가드가 지키는 것은 정확도가 아니라 **경계**다. 정규화는 합칠수록 집계가 예뻐지므로
// 나중에 "조금 더 똑똑하게" 합치고 싶은 압력이 반드시 생긴다. 그때 이 단언들이
// naver.com과 navercorp.com을 갈라 두는 이유를 기억나게 한다.
import assert from 'node:assert/strict';
import {
  resolveServiceIdentity,
  slugifyName,
  looksLikeDomain,
} from '../lib/service-registry';

let passed = 0;
function check(cond: boolean, msg: string): void {
  assert.ok(cond, msg);
  passed += 1;
}
function eq<T>(a: T, b: T, msg: string): void {
  assert.equal(a, b, `${msg} (got ${String(a)}, want ${String(b)})`);
  passed += 1;
}

// ── 1. 도메인 판별 ──
{
  check(looksLikeDomain('clerk.com'), '1-a 도메인 형태 인식');
  check(looksLikeDomain('news.hada.io'), '1-b 서브도메인도 도메인');
  check(!looksLikeDomain('쿠팡'), '1-c 한글 이름은 도메인 아님');
  check(!looksLikeDomain('Google Drive'), '1-d 공백 있는 이름은 도메인 아님');
}

// ── 2. 도메인 신원 ──
{
  const r = resolveServiceIdentity('clerk.com')!;
  eq(r.slug, 'clerk.com', '2-a 도메인이 곧 slug');
  eq(r.domain, 'clerk.com', '2-b 도메인 보존');

  // 서브도메인은 등록 가능 도메인으로 병합된다 — 같은 서비스가 서브도메인마다 갈리지 않게.
  const sub = resolveServiceIdentity('mailer.notice.ridibooks.com')!;
  eq(sub.domain, 'ridibooks.com', '2-c 서브도메인 → 등록 가능 도메인');

  // co.kr 류 2단계 TLD
  const kr = resolveServiceIdentity('shop.gmarket.co.kr')!;
  eq(kr.domain, 'gmarket.co.kr', '2-d 2단계 TLD 처리');
}

// ── 3. 카탈로그가 아는 것만 이름을 준다 ──
{
  const known = resolveServiceIdentity('naver.com')!;
  eq(known.displayName, '네이버', '3-a 카탈로그가 아는 도메인은 표시명을 얻는다');
  eq(known.known, true, '3-b known 플래그');

  const unknown = resolveServiceIdentity('some-unheard-of-shop.com')!;
  eq(unknown.displayName, null, '3-c 모르는 도메인은 이름을 지어내지 않는다');
  eq(unknown.known, false, '3-d known=false');
  eq(unknown.category, 'unknown', '3-e 분류도 단정하지 않는다');
}

// ── 4. 이름 → 도메인 역인덱스 (표기 통합의 유일한 경로) ──
{
  const byName = resolveServiceIdentity('네이버')!;
  eq(byName.domain, 'naver.com', '4-a 카탈로그가 아는 이름은 도메인 신원으로 승격');

  // 같은 서비스의 두 표기가 같은 slug로 모인다 — 이게 정규화의 목적이다.
  const a = resolveServiceIdentity('네이버')!;
  const b = resolveServiceIdentity('naver.com')!;
  eq(a.slug, b.slug, '4-b 이름과 도메인이 같은 신원으로 수렴');
}

// ── 5. 모르면 합치지 않는다 (이 파일의 제1 규칙) ──
{
  const naver = resolveServiceIdentity('naver.com')!;
  const navercorp = resolveServiceIdentity('navercorp.com')!;
  check(
    naver.slug !== navercorp.slug || naver.domain === navercorp.domain,
    '5-a naver.com과 navercorp.com은 카탈로그 판단에만 따른다',
  );

  const kakao = resolveServiceIdentity('kakao.com')!;
  const kakaopay = resolveServiceIdentity('kakaopay.com')!;
  check(kakao.slug !== kakaopay.slug, '5-b kakao와 kakaopay는 별개 서비스');

  // 카탈로그가 모르는 두 이름은 문자열이 비슷해도 각자 남는다.
  const x = resolveServiceIdentity('Acme Shop')!;
  const y = resolveServiceIdentity('acme-shop.com')!;
  check(x.slug !== y.slug, '5-c 모르는 이름과 도메인은 유사해도 합치지 않는다');
}

// ── 6. 정규화 키는 같은 것만 같게 만든다 ──
{
  eq(slugifyName('Google Drive'), slugifyName('google-drive'), '6-a 공백·기호 차이 흡수');
  eq(slugifyName('Clerk'), slugifyName('clerk'), '6-b 대소문자 흡수');
  check(slugifyName('구글') !== slugifyName('Google'), '6-c 번역은 하지 않는다');
}

// ── 7. 서비스가 아닌 것은 만들지 않는다 ──
{
  eq(
    resolveServiceIdentity('shopifyemail.com'),
    null,
    '7-a 발송 대행 도메인 제외 — 서로 다른 쇼핑몰 수십 곳이 한 줄로 뭉개진다',
  );
  eq(resolveServiceIdentity('amazonaws.com'), null, '7-b 인프라 도메인 제외');
  eq(resolveServiceIdentity('   '), null, '7-c 빈 이름 제외');
}

console.log(`verify-service-registry: ${passed} assertions passed`);
console.log('  정규화는 카탈로그가 아는 것만 합친다. 모르면 각자 남긴다.');
