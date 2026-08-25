// 심사용 계정이 배포된 주소에서 실제로 로그인되고 화면 데이터가 나오는지 — 읽기만 한다.
//
// 실행: pnpm exec tsx scripts/verify-judge-login.ts <이메일> <비밀번호> [https://...]
//
// 왜: 제출 문서에 계정을 적어 두고 심사 당일에 안 들어가지면 그걸로 끝이다. 계정을 만든
// 것과 그 계정으로 들어가지는 것은 다른 사실이고, DB에 행이 생겼다는 것은 앞엣것만
// 증명한다. 로그인 → 인벤토리 → 점수까지 배포된 경로로 한 번 통과시켜 본다.
//
// 세션 쿠키를 손으로 물고 다닌다(브라우저 없이). 쓰기는 하지 않는다.
export {};

const [email, password, baseArg] = process.argv.slice(2);
const BASE = (baseArg ?? 'https://service-app-seven-virid.vercel.app').replace(/\/$/, '');

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

const jar = new Map<string, string>();
function absorb(res: Response): void {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
function cookieHeader(): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function get(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader() },
    redirect: 'manual',
  });
  absorb(res);
  return res;
}

async function main(): Promise<void> {
  if (!email || !password) {
    console.error('사용법: verify-judge-login.ts <이메일> <비밀번호> [base]');
    process.exitCode = 1;
    return;
  }

  // CSRF 토큰을 먼저 받아야 자격증명 로그인이 통과한다(Auth.js).
  const csrfRes = await get('/api/auth/csrf');
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  check(typeof csrfToken === 'string' && csrfToken.length > 0, '1 CSRF 토큰을 받는다');

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${BASE}/dashboard` }),
    redirect: 'manual',
  });
  absorb(loginRes);
  const location = loginRes.headers.get('location') ?? '';
  check(
    loginRes.status >= 300 && loginRes.status < 400 && !location.includes('error'),
    `2 자격증명 로그인 통과 (status=${loginRes.status} · ${location.slice(0, 80)})`,
  );

  const session = await (await get('/api/auth/session')).json();
  check(
    (session as { user?: { email?: string } })?.user?.email === email,
    `3 세션이 그 사용자로 열린다 (${JSON.stringify(session).slice(0, 80)})`,
  );

  const accRes = await get('/api/accounts');
  const acc = (await accRes.json()) as { data?: unknown[] };
  check(accRes.status === 200, `4 인벤토리 조회 200 (실제 ${accRes.status})`);
  check((acc.data?.length ?? 0) > 0, `5 인벤토리가 비어 있지 않다 (${acc.data?.length ?? 0}건)`);

  const scoreRes = await get('/api/score');
  const score = (await scoreRes.json()) as {
    data?: { score?: number; axes?: Record<string, { measured?: boolean }> };
  };
  check(scoreRes.status === 200, `6 점수 조회 200 (실제 ${scoreRes.status})`);
  const axes = score.data?.axes ?? {};
  const measuredN = Object.values(axes).filter((a) => a?.measured).length;
  check(
    typeof score.data?.score === 'number',
    `7 종합 점수가 숫자로 온다 (${score.data?.score})`,
  );
  check(measuredN === 4, `8 4축이 모두 측정된다 (측정 ${measuredN}/4)`);

  console.log(`verify-judge-login: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
