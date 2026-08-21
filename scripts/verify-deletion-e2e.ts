// 탈퇴 E2E — 실제 서버에 로그인해서 라우트를 통과시킨다.
//
// 실행: (다른 창에서 next start 띄운 뒤)
//   pnpm exec tsx --env-file=.env scripts/verify-deletion-e2e.ts http://localhost:3022
//
// verify-account-deletion.ts와 무엇이 다른가: 그쪽은 lib 함수를 직접 불러 cascade를 잰다.
// 여기서는 **HTTP를 통과시킨다** — 미들웨어, 세션 쿠키, 확인 문구 대조까지 실제 경로로 지난다.
// 삭제 기능에서 정말 무서운 것은 "지워지지 않는 것"이 아니라 **아무나 지울 수 있는 것**이고,
// 그건 lib를 직접 부르는 검증으로는 절대 잡히지 않는다.
//
// 안전: 이 스크립트가 가입시킨 계정만 쓰고, 마지막에 그 계정을 지우는 것으로 끝난다.
const BASE = process.argv[2] ?? 'http://localhost:3022';
const EMAIL = `e2e-deletion-${Date.now()}@example.invalid`;
const PASSWORD = 'verify-deletion-pw-2026';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

/** 최소 쿠키 항아리. Auth.js는 csrf 쿠키와 세션 쿠키를 나눠 심는다. */
const jar = new Map<string, string>();
function absorb(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
function cookieHeader(): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
  });
  absorb(res);
  return res;
}

async function main() {
  // ── 로그인 없이 ──
  check((await call('/api/me')).status === 401, '1 미인증 GET은 401');
  check(
    (
      await call('/api/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: EMAIL }),
      })
    ).status === 401,
    '2 미인증 DELETE는 401 — 확인 문구가 맞아도 세션 없이는 못 지운다',
  );
  check((await call('/settings')).status === 302, '3 미인증 /settings는 로그인으로 되돌린다');

  // ── 가입 + 로그인 ──
  const reg = await call('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: '탈퇴 E2E' }),
  });
  check(reg.status === 201, `4 시험 계정 가입 (실제 ${reg.status})`);

  const csrf = (await (await call('/api/auth/csrf')).json()) as { csrfToken: string };
  const login = await call('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/dashboard`,
    }).toString(),
  });
  const hasSession = [...jar.keys()].some((k) => k.includes('session-token'));
  check(hasSession, `5 로그인해서 세션을 받았다 (login ${login.status})`);
  if (!hasSession) throw new Error('세션을 받지 못해 이후 검증을 진행할 수 없습니다.');

  // ── 보관 현황 ──
  const meRes = await call('/api/me');
  const me = (await meRes.json()) as { ok: boolean; data?: { email: string; accounts: number } };
  check(meRes.status === 200 && me.ok, '6 인증 후 GET은 보관 현황을 준다');
  check(me.data?.email === EMAIL, '7 현황이 내 이메일을 돌려준다');
  check(me.data?.accounts === 0, '8 갓 가입한 계정은 목록이 비어 있다(시드를 심지 않는다)');

  // ── 확인 문구 ──
  async function del(confirm: unknown) {
    const res = await call('/api/me', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });
    return { status: res.status, body: (await res.json()) as { ok: boolean; reason?: string } };
  }

  const wrong = await del('아니오');
  check(wrong.status === 400 && wrong.body.reason === 'confirm_mismatch', '9 틀린 문구는 400');
  const empty = await del('');
  check(empty.status === 400, '10 빈 문구는 400');
  const missing = await del(undefined);
  check(missing.status === 400, '11 confirm 자체가 없어도 400(본문 없이 호출 불가)');

  const still = (await (await call('/api/me')).json()) as { ok: boolean };
  check(still.ok, '12 실패한 삭제 시도 뒤에도 계정은 그대로다');

  // ── 실제 삭제 ──
  const done = await del(EMAIL.toUpperCase());
  check(done.status === 200 && done.body.ok, '13 대소문자가 달라도 같은 주소면 삭제된다');

  const after = await call('/api/me');
  check(after.status === 401, '14 삭제 후 같은 쿠키로는 401 — 세션이 남아도 데이터는 없다');

  console.log(`verify-deletion-e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
