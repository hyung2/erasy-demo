// 로그인 직후 착지점이 사용자 상태에 따라 갈리는지 — 격리 DB + 로컬 서버.
//
// 실행: BASE_URL=http://localhost:3020 pnpm exec tsx scripts/verify-after-login.ts
//
// 왜: 로그인은 늘 /scanning으로 보냈다. 그래서 이미 계정을 모아 둔 사용자도 들어올 때마다
// 4단계 온보딩을 다시 지나야 했다. 매번 하는 일이 "건너뛰기를 네 번 누르는 것"이면 그건
// 온보딩이 아니라 통행세다(2026-08-26).
//
// 두 방향을 함께 막는다. 되돌아가면 재방문자가 다시 온보딩을 맞고, 반대로 과하게 고치면
// 신규 사용자가 빈 대시보드에 떨어져 무엇을 해야 할지 모른다.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';

export {};

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3020').replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('[abort] DATABASE_URL이 로컬이 아닙니다. 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

type Jar = Map<string, string>;
function absorb(jar: Jar, res: Response): void {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieOf = (jar: Jar): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function login(email: string, pw: string): Promise<Jar> {
  const jar: Jar = new Map();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  absorb(jar, csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  absorb(
    jar,
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieOf(jar) },
      body: new URLSearchParams({ email, password: pw, csrfToken, callbackUrl: `${BASE}/dashboard` }),
      redirect: 'manual',
    }),
  );
  return jar;
}

/** /after-login이 어디로 보내는지. 따라가지 않고 Location만 본다. */
async function landing(jar: Jar): Promise<string> {
  const res = await fetch(`${BASE}/after-login`, {
    headers: { cookie: cookieOf(jar) },
    redirect: 'manual',
  });
  return res.headers.get('location') ?? `(리다이렉트 없음 · ${res.status})`;
}

const NEW = { id: `uafter-new-${Date.now()}`, pw: 'after-login-2026' };
const OLD = { id: `uafter-old-${Date.now()}`, pw: 'after-login-2026' };

async function main(): Promise<void> {
  for (const u of [NEW, OLD]) {
    await prisma.user.create({
      data: { id: u.id, email: `${u.id}@example.invalid`, name: u.id, passwordHash: await hashPassword(u.pw) },
    });
  }
  // 재방문자 = 이미 계정을 갖고 있는 사람. 온보딩을 끝냈다는 별도 플래그를 두지 않는다.
  await prisma.account.create({
    data: {
      id: `${OLD.id}-a0`,
      userId: OLD.id,
      name: '기존서비스',
      provider: 'manual',
      category: 'domestic',
      source: 'user_input',
    },
  });

  const newLanding = await landing(await login(`${NEW.id}@example.invalid`, NEW.pw));
  check(
    newLanding.endsWith('/scanning'),
    `1 계정이 없으면 온보딩으로 (${newLanding})`,
  );

  const oldLanding = await landing(await login(`${OLD.id}@example.invalid`, OLD.pw));
  check(
    oldLanding.endsWith('/dashboard'),
    `2 계정이 있으면 대시보드로 — 매번 온보딩을 다시 지나지 않는다 (${oldLanding})`,
  );

  // 세션 없이 열면 로그인 화면으로. proxy가 먼저 막지만 라우트 스스로도 서 있어야 한다.
  const anon = await fetch(`${BASE}/after-login`, { redirect: 'manual' });
  const anonTo = anon.headers.get('location') ?? '';
  check(
    anon.status >= 300 && anon.status < 400 && !anonTo.includes('/dashboard'),
    `3 미인증은 대시보드로 새지 않는다 (${anon.status} → ${anonTo})`,
  );

  // 재수집 입구는 그대로 살아 있어야 한다 — 강제하지 않는 것과 없애는 것은 다르다.
  const { readFileSync } = await import('node:fs');
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8');
  const scan = readFileSync('app/(app)/scan/page.tsx', 'utf8');
  check(
    dash.includes("'/scanning'") && scan.includes("'/scanning?return=/scan'"),
    '4 앱 안의 다시 찾기 입구 2곳이 남아 있다',
  );

  console.log(`verify-after-login: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [NEW.id, OLD.id] } } });
    await prisma.$disconnect();
  });
