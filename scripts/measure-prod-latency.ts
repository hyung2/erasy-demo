// prod 응답 시간 측정 — 인증된 상태로, DB를 실제로 도는 경로만.
//
// 실행: pnpm exec tsx scripts/measure-prod-latency.ts [https://...]
//
// 왜 계정 0건짜리 임시 계정으로 재는가: 계산 부하를 빼고 **왕복 비용만** 보기 위해서다.
// 계정이 많은 사용자로 재면 "느린 이유가 데이터가 많아서"인지 "왕복이 비싸서"인지 갈리지
// 않는다. 실제로 그 둘을 섞어 보고 265계정을 원인으로 오해한 적이 있다(2026-08-24).
//
// 첫 호출은 콜드 스타트(함수·DB 연결 수립)라 따로 표기한다. 한 번 재고 평균을 말하면
// 그 콜드가 평균에 섞여 "항상 2초"처럼 들린다.
//
// 임시 계정은 이 스크립트가 만들고 마지막에 탈퇴 API로 지운다.
export {};

const BASE = (process.argv[2] ?? 'https://service-app-seven-virid.vercel.app').replace(/\/$/, '');
const EMAIL = `latency-${Date.now()}@example.invalid`;
const PASSWORD = 'latency-probe-pw-2026';
const ROUNDS = 5;

const jar = new Map<string, string>();
function absorb(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  absorb(res);
  return res;
}

function stats(times: number[]): string {
  const warm = times.slice(1);
  const sorted = [...warm].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return `콜드 ${times[0]}ms · 웜 중앙값 ${median}ms · 웜 ${warm.join('/')}`;
}

async function main() {
  console.log(`대상 ${BASE}`);

  const reg = await call('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: '지연 측정' }),
  });
  if (reg.status !== 201) throw new Error(`임시 계정 생성 실패 (${reg.status})`);

  const { csrfToken } = (await (await call('/api/auth/csrf')).json()) as { csrfToken: string };
  await call('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/dashboard`,
    }),
  });
  if (![...jar.keys()].some((k) => k.includes('session-token'))) throw new Error('로그인 실패');

  for (const path of ['/api/score', '/api/accounts', '/api/guard', '/api/me']) {
    const times: number[] = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const t0 = performance.now();
      const r = await call(`${path}?p=${i}`);
      await r.text();
      times.push(Math.round(performance.now() - t0));
    }
    console.log(`${path.padEnd(16)} ${stats(times)}`);
  }

  const del = await call('/api/me', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: EMAIL }),
  });
  console.log(del.ok ? '\n임시 계정 삭제 완료' : `\n임시 계정 삭제 실패 (${del.status}) — 수동 정리 필요`);
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
