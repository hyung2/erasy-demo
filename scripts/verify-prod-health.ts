// 배포 후 헬스 체크 — 무대에 올릴 주소가 실제로 살아 있는지.
//
// 실행: pnpm exec tsx scripts/verify-prod-health.ts [https://...]
//
// **정적 페이지의 200을 헬스로 읽지 않는다.** 프리렌더 경로는 CDN이 서빙하므로 서버 함수가
// 전부 죽어도 200이 온다(2026-08-13 실측). 그래서 판정은 force-dynamic 라우트로만 한다 —
// 그 응답이 오면 함수 런타임이 실제로 돌았다는 뜻이다.
//
// 정적 경로도 보긴 하지만 상태 코드가 아니라 **본문에 이번 배포의 내용이 있는지**를 본다.
// 200만 보면 3일 전 빌드가 그대로 서빙돼도 통과한다.
// import가 하나도 없으면 TS가 이 파일을 모듈이 아닌 스크립트로 보고, 최상위 이름이 다른
// 검증 스크립트와 같은 전역에 놓여 충돌한다(BASE·passed 등). 모듈임을 명시한다.
export {};

const BASE = (process.argv[2] ?? 'https://service-app-seven-virid.vercel.app').replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

async function main() {
  console.log(`대상 ${BASE}`);

  // ── 1. 함수 런타임 생존 (동적 라우트) ──
  const me = await fetch(`${BASE}/api/me`, { redirect: 'manual' });
  check(me.status === 401, `동적 라우트가 응답한다 — /api/me ${me.status} (기대 401)`);

  const scan = await fetch(`${BASE}/api/breach/scan`, { method: 'POST', redirect: 'manual' });
  // 401(세션 없음)이면 함수가 살아 있다. 503은 키 미설정이라 그것도 함수는 살아 있는 것.
  check(
    scan.status === 401 || scan.status === 503,
    `유출 대조 라우트가 응답한다 — ${scan.status} (기대 401 또는 503)`,
  );

  const csp = await fetch(`${BASE}/api/csp-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check(csp.status === 204, `CSP 수집 창구가 열려 있다 — ${csp.status} (기대 204)`);

  // ── 2. 미들웨어 ──
  const guarded = await fetch(`${BASE}/settings`, { redirect: 'manual' });
  check(
    guarded.status === 307 || guarded.status === 302,
    `보호 라우트가 로그인으로 돌린다 — /settings ${guarded.status}`,
  );

  // ── 3. 이번 배포가 실제로 서빙되는가 (본문 대조) ──
  const privacy = await fetch(`${BASE}/privacy`);
  const html = await privacy.text();
  check(html.includes('통계 목적 이용'), '방침에 통계 목적 이용 절이 있다(이번 배포 반영)');
  check(html.includes('설정 화면에서 직접 탈퇴할 수 있습니다'), '방침이 탈퇴 기능을 안내한다');
  check(!html.includes('직접 탈퇴하는 기능은 제공하지 않습니다'), '옛 탈퇴 문구가 남지 않았다');

  // ── 4. 보안 헤더 ──
  const cspHeader = privacy.headers.get('content-security-policy-report-only');
  check(cspHeader !== null, 'CSP Report-Only 헤더가 붙는다');
  check(
    cspHeader?.includes('report-uri /api/csp-report') ?? false,
    'CSP가 위반을 우리 창구로 보낸다',
  );
  check(
    privacy.headers.get('strict-transport-security') !== null,
    'HSTS 헤더가 붙는다',
  );

  console.log(`verify-prod-health: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
