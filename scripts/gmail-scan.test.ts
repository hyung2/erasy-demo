// Gmail 스캔 순수 로직 픽스처 — 네트워크·계정 없이 도는 회귀 가드.
// 실행: pnpm exec tsx scripts/gmail-scan.test.ts
//
// 여기서 지키려는 것
//  - From 헤더 파싱이 표시이름·서브도메인·대문자에 흔들리지 않는다
//  - 상표를 끼워 넣은 유사 도메인(evil-netflix.com)을 서비스로 오인하지 않는다
//  - 같은 서비스 여러 건은 최신 1건으로 접힌다
//  - 카탈로그 밖 도메인은 "미발견"으로 집계된다(조용히 버리지 않는다)
import { extractDomain, matchService } from '../lib/gmail-catalog';
import { foldMessages, diffAgainstInventory, type MessageMeta } from '../lib/gmail-scan';

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

// 고정 기준 시각 — 테스트가 실행 시점에 흔들리지 않게 한다.
const NOW = Date.UTC(2026, 6, 28, 0, 0, 0); // 2026-07-28
const DAY = 86_400_000;

// ── (a) From 파싱 ──
const fromCases: Array<[string, string | null]> = [
  ['Netflix <info@mailer.netflix.com>', 'mailer.netflix.com'],
  ['info@netflix.com', 'netflix.com'],
  ['"토스, Toss" <noreply@TOSS.IM>', 'toss.im'],
  ['배달의민족 <no-reply@baemin.com>, ', 'baemin.com'],
  ['깨진주소', null],
  ['nobody@localhost', null],
];
for (const [input, expected] of fromCases) {
  const got = extractDomain(input);
  check(`a  From 파싱 "${input.slice(0, 28)}"`, got === expected, `${got} (기대 ${expected})`);
}

// ── (b) 도메인 매칭 ──
check('b1 서브도메인 접미사 매칭', matchService('mailer.netflix.com')?.service === 'Netflix', String(matchService('mailer.netflix.com')?.service));
check('b2 정확 일치', matchService('toss.im')?.service === '토스', String(matchService('toss.im')?.service));
check(
  'b3 상표 끼워넣기 오탐 차단',
  matchService('evil-netflix.com') === null,
  String(matchService('evil-netflix.com')?.service ?? 'null'),
);
check(
  'b4 더 구체적인 도메인 우선',
  matchService('drive.google.com')?.service === 'Google Drive',
  String(matchService('drive.google.com')?.service),
);
check('b5 카탈로그 밖', matchService('unknown-service.co.kr') === null, String(matchService('unknown-service.co.kr')?.service ?? 'null'));

// ── (c) 접기(fold) ──
const messages: MessageMeta[] = [
  { from: 'Netflix <info@mailer.netflix.com>', receivedAt: NOW - 400 * DAY },
  { from: 'Netflix <billing@netflix.com>', receivedAt: NOW - 12 * DAY }, // 더 최신
  { from: '토스 <noreply@toss.im>', receivedAt: NOW - 3 * DAY },
  { from: '쿠팡 <no-reply@coupang.com>', receivedAt: NOW - 800 * DAY },
  { from: 'noreply@some-random-shop.co.kr', receivedAt: NOW - 5 * DAY }, // 미매칭
  { from: 'noreply@another-unknown.io', receivedAt: NOW - 6 * DAY }, // 미매칭
];
const result = foldMessages(messages, NOW);

const netflix = result.hits.find((h) => h.service === 'Netflix');
check('c1 서비스 수', result.hits.length === 3, `${result.hits.length}건 (기대 3)`);
check('c2 최신 1건으로 접힘', netflix?.lastSeenDays === 12, `Netflix ${netflix?.lastSeenDays}일 (기대 12)`);
check('c3 건수 누적', netflix?.messageCount === 2, `${netflix?.messageCount}건 (기대 2)`);
check('c4 미매칭 도메인 집계', result.unmatchedDomains === 2, `${result.unmatchedDomains}건 (기대 2)`);
check('c5 스캔 총량 보존', result.scanned === messages.length, `${result.scanned}건`);
check(
  'c6 최신순 정렬',
  result.hits[0].service === '토스',
  `선두=${result.hits[0].service} (기대 토스)`,
);
check(
  'c7 오래된 계정 경과일',
  result.hits.find((h) => h.service === '쿠팡')?.lastSeenDays === 800,
  `쿠팡 ${result.hits.find((h) => h.service === '쿠팡')?.lastSeenDays}일`,
);

// ── (d) 인벤토리 대조 ──
const { discovered, updated } = diffAgainstInventory(result.hits, ['Netflix', '쿠 팡']);
check('d1 기존 계정은 갱신 대상', updated.map((h) => h.service).sort().join(',') === 'Netflix,쿠팡', updated.map((h) => h.service).join(','));
check('d2 신규는 발견 대상', discovered.map((h) => h.service).join(',') === '토스', discovered.map((h) => h.service).join(','));
check('d3 표기 흔들림 흡수(공백 무시)', !discovered.some((h) => h.service === '쿠팡'), '쿠팡이 신규로 잡히지 않음');

console.log(failures === 0 ? '\ngmail-scan: 전 항목 PASS' : `\ngmail-scan: ${failures}건 FAIL`);
process.exit(failures === 0 ? 0 : 1);
