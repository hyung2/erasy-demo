// 개방 모드 메일 스캔(A1) fixture — DB·네트워크 불필요, 순수 계산만.
// 실행: pnpm exec tsx scripts/gmail-open-scan.test.ts
//
// 무엇을 지키는 테스트인가
//   기존 스캔은 카탈로그 36개 서비스마다 `from:도메인` 질의를 던져 **찾을 수 있는 상한이
//   목록 크기에 하드코딩**돼 있었다(2026-08-04 실계정 측정: 6곳 발견, 질의 9건 실패).
//   개방 모드는 가입·인증 문구로 찾고 발신 도메인을 집계한다. 카탈로그는 발견 필터가 아니라
//   표시명·분류 사전으로 역할이 바뀐다.
//
//   그 전환에서 지켜야 하는 것 — (1) 카탈로그 밖도 버리지 않는다 (2) 서브도메인이 같은 서비스를
//   여러 계정으로 쪼개지 않는다 (3) 개인 메일 도메인의 지인 메일을 가입으로 세지 않는다(이슈 #4
//   재발 방지) (4) 분류를 모르면 unknown이지 domestic/overseas를 찍지 않는다.
import assert from 'node:assert/strict';
import { foldOpenMessages, type MessageMeta } from '../lib/gmail-scan';
import { resolveOpenSender, registrableDomain, OPEN_SCAN_PHRASES, openScanQuery } from '../lib/gmail-catalog';

let passed = 0;
function check(label: string, cond: boolean, detail: string): void {
  assert.ok(cond, `${label} — ${detail}`);
  console.log(`PASS  ${label} — ${detail}`);
  passed += 1;
}

const NOW = Date.UTC(2026, 7, 4); // 2026-08-04 고정 기준
const day = (n: number) => NOW - n * 86_400_000;
const msg = (from: string, daysAgo: number): MessageMeta => ({ from, receivedAt: day(daysAgo) });

// ── a. 등록 가능 도메인 절단 ──
check('a1 서브도메인 절단', registrableDomain('mailer.notice.ridibooks.com') === 'ridibooks.com',
  registrableDomain('mailer.notice.ridibooks.com'));
check('a2 2단계 국가 TLD 보존', registrableDomain('mail.somewhere.co.kr') === 'somewhere.co.kr',
  registrableDomain('mail.somewhere.co.kr'));
check('a3 이미 최소 형태', registrableDomain('discord.com') === 'discord.com', registrableDomain('discord.com'));

// ── b. 발신자 판정 ──
{
  const v = resolveOpenSender('쿠팡 <noreply@coupang.com>');
  check('b1 카탈로그 적중은 표시명 사용', v.kind === 'known' && v.entry.service === '쿠팡',
    v.kind === 'known' ? v.entry.service : v.kind);
}
{
  const v = resolveOpenSender('RIDI <no-reply@mailer.ridibooks.com>');
  check('b2 카탈로그 밖도 서비스로 인정', v.kind === 'discovered' && v.name === 'ridibooks.com',
    v.kind === 'discovered' ? v.name : v.kind);
}
{
  // 이슈 #4 재발 방지 — 개인 메일 도메인의 사람 메일은 가입 근거가 아니다.
  const v = resolveOpenSender('홍길동 <gildong@naver.com>');
  check('b3 개인 메일 도메인의 지인 메일 제외', v.kind === 'personal', v.kind);
}
{
  const v = resolveOpenSender('네이버 <noreply@naver.com>');
  check('b4 개인 메일 도메인의 발신 전용은 인정', v.kind === 'known', v.kind);
}
{
  // 성이 '노'인 사람을 발신 전용으로 오인하지 않는다(기존 판정 규칙 승계 확인).
  const v = resolveOpenSender('노재현 <no.jaehyun@gmail.com>');
  check('b5 no.* 사람 이름 보호', v.kind === 'personal', v.kind);
}
{
  const v = resolveOpenSender('깨진 헤더');
  check('b6 주소 없는 헤더', v.kind === 'invalid', v.kind);
}

// ── c. 접기 ──
{
  const r = foldOpenMessages(
    [
      msg('RIDI <no-reply@mailer.ridibooks.com>', 400),
      msg('RIDI <noreply@ridibooks.com>', 10), // 같은 서비스, 다른 서브도메인 + 더 최신
      msg('쿠팡 <noreply@coupang.com>', 30),
      msg('친구 <friend@gmail.com>', 5), // 제외 대상
      // 카탈로그 밖 국내 도메인(2단계 TLD) — Discord 등 카탈로그 등재 서비스를 쓰면
      // 'known'으로 잡혀 unnamed 집계를 검증할 수 없다.
      msg('어딘가 <noreply@mail.somewhere.co.kr>', 900),
    ],
    NOW,
  );
  const names = r.hits.map((h) => h.service).sort();
  check('c1 서비스 3곳으로 접힘', r.hits.length === 3, names.join(','));
  check('c2 서브도메인 중복 병합', names.filter((n) => n === 'ridibooks.com').length === 1, names.join(','));
  const ridi = r.hits.find((h) => h.service === 'ridibooks.com')!;
  check('c3 최신 수신일 채택', ridi.lastSeenDays === 10, `${ridi.lastSeenDays}일`);
  check('c4 병합 건수 유지', ridi.messageCount === 2, `${ridi.messageCount}건`);
  check('c5 지인 메일 제외 집계', r.excludedPersonal === 1, `${r.excludedPersonal}건`);
  check('c6 카탈로그 밖은 unknown 분류', ridi.category === 'unknown', String(ridi.category));
  const coupang = r.hits.find((h) => h.service === '쿠팡')!;
  check('c7 카탈로그 적중은 사전 분류', coupang.category === 'domestic', String(coupang.category));
  check('c8 이름 미확정 건수 노출', r.unnamed === 2, `${r.unnamed}건 (ridibooks.com·somewhere.co.kr)`);
  check('c9 버리는 도메인 없음', r.unmatchedDomains === 0, `${r.unmatchedDomains}`);
  check('c10 훑은 건수 보고', r.scanned === 5, `${r.scanned}건`);
}

// ── c2. 발송 대행 도메인 제외 ──
{
  const v = resolveOpenSender('Shop <noreply@shopifyemail.com>');
  check('f1 발송 대행은 서비스로 담지 않음', v.kind === 'infra', v.kind);
}
{
  const v = resolveOpenSender('AWS <no-reply@amazonaws.com>');
  check('f2 클라우드 알림 경로도 제외', v.kind === 'infra', v.kind);
}
{
  // 대행사를 통해 보낸 서로 다른 쇼핑몰이 한 줄로 뭉개지면 안 된다 — 담지 않는 이유.
  const r = foldOpenMessages(
    [
      msg('A샵 <noreply@shopifyemail.com>', 3),
      msg('B샵 <noreply@shopifyemail.com>', 8),
      msg('센드그리드 경유 <bounce@sendgrid.net>', 12),
      msg('RIDI <noreply@ridibooks.com>', 20),
    ],
    NOW,
  );
  check('f3 대행 도메인은 hits에 없음', r.hits.length === 1 && r.hits[0].service === 'ridibooks.com',
    r.hits.map((h) => h.service).join(','));
  check('f4 제외 건수 집계', r.excludedInfra === 3, `${r.excludedInfra}건`);
  check('f5 제외 도메인 노출', r.infraDomains.includes('shopifyemail.com'), r.infraDomains.join(','));
  check('f6 많이 보낸 순 정렬', r.infraDomains[0] === 'shopifyemail.com', r.infraDomains.join(','));
}

// ── d. 질의문 ──
{
  const q = openScanQuery();
  check('d1 문구가 OR로 묶임', q.includes(' OR ') && q.startsWith('"'), q.slice(0, 40) + '…');
  check('d2 가입 문구 포함', q.includes('"회원가입"') && q.includes('"verify your email"'), '한/영 모두');
  // 인증번호는 은행·2FA·주문확인에 광범위해 정밀도를 깎는다 — 의도적 제외(레드팀 M5).
  check('d3 광범위 문구 제외', !OPEN_SCAN_PHRASES.includes('인증번호' as never), '인증번호 미포함');
}

// ── e. 빈 입력 ──
{
  const r = foldOpenMessages([], NOW);
  check('e1 빈 결과는 0건', r.hits.length === 0 && r.scanned === 0, 'hits 0');
  check('e2 미발견을 "없음"으로 단정하지 않음', r.unnamed === 0 && r.unmatchedDomains === 0, '집계값 0');
}

console.log('');
console.log(`gmail-open-scan: ${passed} assertions passed`);
