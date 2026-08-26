// 표시명 전환이 링크를 끊지 않는지 — 소스 스캔, 자원 불필요.
//
// 실행: pnpm exec tsx scripts/verify-display-name.ts
//
// 무엇을 지키는가
//   (1) 화면 이름은 **사람이 확인한** 표시명일 때만 바뀐다. 자동 수집이 채운 값을 앞세우면
//       화면이 근거 없이 달라진다.
//   (2) 링크는 **수집 원문**으로 찾는다. 정리 경로는 서비스명으로 카탈로그를 뒤져 도메인을
//       얻는데, 표시명을 예쁘게 바꾸면 그 조회가 빗나가 링크가 사라진다.
//       화면을 다듬는 변경이 기능을 조용히 끄는 일은 없어야 한다.
//   (3) 확인된 표시명이 없으면 수집 원문 그대로 둔다. 도메인으로 수집된 계정을 보기 좋게
//       만들려면 "bccard.com → BC카드" 같은 번역이 필요한데 그건 지어내는 것이다.
//       TLD를 기계적으로 떼면 "Bccard"가 되어 도메인보다 나쁘다.
import { readFileSync } from 'node:fs';

export {};

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

function main(): void {
  const api = readFileSync('app/api/accounts/route.ts', 'utf8');
  const dto = readFileSync('lib/api-types.ts', 'utf8');
  const cleanup = readFileSync('app/(app)/cleanup/page.tsx', 'utf8');

  // (1) 확인된 것만 쓴다
  check(
    /verifiedAt && r\.service\.displayName \? r\.service\.displayName : r\.name/.test(api),
    '1 확인된 표시명이 있을 때만 이름을 바꾼다',
  );
  check(
    /include: \{ service: \{ select: \{ displayName: true, verifiedAt: true \} \} \}/.test(api),
    '2 표시명과 확인 여부를 함께 읽는다 — 확인 여부 없이 표시명만 읽으면 게이트가 무의미하다',
  );

  // (2) 링크는 원문으로
  check(/linkName\?: string;/.test(dto), '3 DTO가 링크용 원문 이름을 따로 갖는다');
  check(/linkName: r\.name/.test(api), '4 링크용 이름에는 수집 원문을 담는다');
  check(
    /destinationFor\(\{\s*name: a\.linkName \?\? a\.name/.test(cleanup),
    '5 정리 경로는 표시명이 아니라 원문으로 찾는다',
  );

  // (3) 지어내지 않는다 — 도메인에서 이름을 만들어 내는 변환이 없어야 한다
  const fabricate = /replace\([^)]*\\\.(com|co\.kr|net|org)/.test(api) || /split\('\.'\)\[0\]/.test(api);
  check(!fabricate, '6 도메인에서 표시명을 만들어 내지 않는다');

  console.log(`verify-display-name: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
