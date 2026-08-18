/**
 * IDOR 2-user 실측 (W5) — 두 사용자를 실제로 가입시키고, 실제 세션 쿠키로 HTTP 왕복해
 * "남의 계정 id를 알면 만질 수 있는가"를 잰다.
 *
 * 기존 가드(verify-cleanup-queue)는 lib 함수를 단일 프로세스에서 직접 호출해 소유권을 검사한다.
 * 그건 도메인 규칙이 맞는지를 재는 것이고, 이 스크립트는 **라우트·세션·쿠키를 통과한 뒤에도**
 * 그 규칙이 살아 있는지를 잰다. 둘은 다른 질문이다 — 세션에서 userId를 잘못 꺼내면
 * lib은 멀쩡한데 라우트만 뚫린다.
 *
 * 실행: 격리 DB + dev 서버를 띄운 뒤
 *   BASE_URL=http://localhost:3020 tsx scripts/verify-idor-2user.ts
 *
 * prod·공유 DB 오염 가드: DATABASE_URL이 localhost가 아니면 즉시 중단한다.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3020';
const DB = process.env.DATABASE_URL ?? '';

if (!/localhost|127\.0\.0\.1/.test(DB)) {
  console.error('[abort] DATABASE_URL이 로컬이 아닙니다. 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();

// 고정 자격 — 실행 끝에 전량 삭제한다. 재실행 시 중복 409는 정상 흐름으로 흡수.
const USERS = [
  { email: 'idor-a@erasy.test', pw: 'IdorTestA-2026!', name: 'IDOR A' },
  { email: 'idor-b@erasy.test', pw: 'IdorTestB-2026!', name: 'IDOR B' },
];

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** Set-Cookie 헤더들을 "k=v; k=v" 요청 헤더 형태로 접는다. */
function foldCookies(res: Response, jar: Map<string, string>) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

/** 자체 가입 → Credentials 로그인. 반환값은 그 사용자의 쿠키 항아리. */
async function signIn(u: (typeof USERS)[number]): Promise<Map<string, string>> {
  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.pw, name: u.name }),
  });
  if (![200, 201, 409].includes(reg.status)) {
    throw new Error(`register 실패 ${reg.status}: ${await reg.text()}`);
  }

  const jar = new Map<string, string>();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  foldCookies(csrfRes, jar);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const form = new URLSearchParams({
    csrfToken,
    email: u.email,
    password: u.pw,
    callbackUrl: `${BASE}/dashboard`,
  });
  const login = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
    },
    body: form,
    redirect: 'manual',
  });
  foldCookies(login, jar);

  const hasSession = [...jar.keys()].some((k) => k.includes('session-token'));
  if (!hasSession) throw new Error(`로그인 실패 ${login.status} — 세션 쿠키 없음`);
  return jar;
}

/**
 * dev 서버 왕복. 한 번은 재시도한다 — 검사 중간에 Prisma 조회로 몇 초 쉬면 서버가 먼저
 * 닫은 유휴 소켓을 undici가 재사용해 "fetch failed"로 죽는 것을 실측했다. 검증 스크립트가
 * 대상이 아니라 자기 커넥션 때문에 FAIL하는 자리를 없앤다.
 */
async function api(path: string, jar: Map<string, string>, init: RequestInit = {}) {
  const send = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader(jar),
        ...(init.headers ?? {}),
      },
    });
  try {
    return await send();
  } catch {
    return await send();
  }
}

async function main() {
  const [jarA, jarB] = [await signIn(USERS[0]), await signIn(USERS[1])];

  // A의 계정 인벤토리에서 표적 id를 하나 뽑는다. 가입 시 데모 데이터가 프로비저닝된다.
  const listA = await api('/api/accounts', jarA);
  const bodyA = (await listA.json()) as { data: { id: string; name: string }[] };
  const targetA = bodyA.data[0];
  if (!targetA) throw new Error('A 인벤토리가 비어 표적을 못 잡음');

  const listB = await api('/api/accounts', jarB);
  const bodyB = (await listB.json()) as { data: { id: string }[] };
  const idsB = new Set(bodyB.data.map((a) => a.id));

  // 0. 전제 — 두 사용자의 인벤토리가 겹치지 않아야 이후 검사가 의미를 가진다.
  record(
    '0. 인벤토리 분리',
    !idsB.has(targetA.id) && bodyA.data.length > 0 && bodyB.data.length > 0,
    `A ${bodyA.data.length}건 / B ${bodyB.data.length}건, 교집합 ${
      bodyA.data.filter((a) => idsB.has(a.id)).length
    }건`,
  );

  // 1. 남의 계정 상세 접근(GET /api/accounts/[id]/access)
  const r1 = await api(`/api/accounts/${targetA.id}/access`, jarB);
  record(
    '1. 타인 계정 상세 접근 차단',
    [403, 404].includes(r1.status),
    `B → A의 계정 접근 = ${r1.status} (기대 403/404)`,
  );

  // 2. 남의 계정 수정(PATCH /api/accounts/[id]) — 자가신고 신호를 남의 계정에 심을 수 있는가
  const r2 = await api(`/api/accounts/${targetA.id}`, jarB, {
    method: 'PATCH',
    body: JSON.stringify({ twoFactorEnabled: true, discovered: false }),
  });
  record(
    '2. 타인 계정 수정 차단',
    [403, 404].includes(r2.status),
    `B → A의 계정 PATCH = ${r2.status} (기대 403/404)`,
  );

  // 3. 남의 계정을 내 정리 큐에 담기(POST /api/cleanup/requests)
  const r3 = await api('/api/cleanup/requests', jarB, {
    method: 'POST',
    body: JSON.stringify({ accountIds: [targetA.id] }),
  });
  // 라우트는 소유권 필터를 통과시킨 결과를 201로 돌려준다. 그래서 상태코드가 아니라
  // 응답 계약(queued·notFound)과 DB 실제 적재를 봐야 담겼는지 알 수 있다.
  const b3 = (await r3.json().catch(() => ({}))) as {
    data?: { queued: number; alreadyQueued: number; notFound: number };
  };
  const rowsForB = await prisma.cleanupRequest.count({
    where: { accountId: targetA.id, user: { email: USERS[1].email } },
  });
  record(
    '3. 타인 계정 큐 담기 차단',
    b3.data?.queued === 0 && b3.data?.notFound === 1 && rowsForB === 0,
    `B → A의 계정 담기 = ${r3.status}, queued ${b3.data?.queued} / notFound ${b3.data?.notFound}, B 큐의 실제 적재 ${rowsForB}건`,
  );

  // 4. 남의 큐에서 빼기(DELETE) — A가 담은 것을 B가 되돌릴 수 있는가
  await api('/api/cleanup/requests', jarA, {
    method: 'POST',
    body: JSON.stringify({ accountIds: [targetA.id] }),
  });
  const beforeA = await api('/api/cleanup/requests', jarA).then(
    (r) => r.json() as Promise<{ data: unknown[] }>,
  );
  const r4 = await api('/api/cleanup/requests', jarB, {
    method: 'DELETE',
    body: JSON.stringify({ accountIds: [targetA.id] }),
  });
  const afterA = await api('/api/cleanup/requests', jarA).then(
    (r) => r.json() as Promise<{ data: unknown[] }>,
  );
  record(
    '4. 타인 큐 빼기 차단',
    beforeA.data.length === afterA.data.length && beforeA.data.length > 0,
    `B의 DELETE = ${r4.status}, A의 큐 ${beforeA.data.length} → ${afterA.data.length}건 (불변이어야 함)`,
  );

  // 5. 점수 격리 — B의 점수가 A의 데이터로 계산되지 않는지(같은 값이면 의심)
  // 가입 시 데모 프로비저닝이 정리 큐도 함께 심으므로, 아무것도 안 하면 A·B의 도달점은
  // 같은 게 정상이다. 격리를 재려면 한쪽 큐만 비워 놓고 두 값이 갈라지는지를 봐야 한다.
  type ScoreBody = { data?: { score?: number; recovery?: { afterComposite?: number | null } } };
  const readScore = (jar: Map<string, string>) =>
    api('/api/score', jar).then((r) => r.json() as Promise<ScoreBody>);

  const queueB = (await api('/api/cleanup/requests', jarB).then(
    (r) => r.json() as Promise<{ data: { accountId: string }[] }>,
  )).data;
  await api('/api/cleanup/requests', jarB, {
    method: 'DELETE',
    body: JSON.stringify({ accountIds: queueB.map((q) => q.accountId) }),
  });

  const [sA, sB] = [await readScore(jarA), await readScore(jarB)];
  const recA = sA.data?.recovery?.afterComposite;
  const recB = sB.data?.recovery?.afterComposite;
  record(
    '5. 회복 투영 사용자별 격리',
    typeof recA === 'number' && typeof recB === 'number' && recA > recB,
    `B의 큐 ${queueB.length}건을 비운 뒤 — A 도달점 ${recA} / B 도달점 ${recB} (A가 높아야 정상)`,
  );

  // 6. 무세션 접근 — 쿠키 없이 같은 요청을 던지면 전부 401이어야 한다.
  const r6 = await fetch(`${BASE}/api/accounts/${targetA.id}/access`);
  record('6. 무세션 접근 차단', r6.status === 401, `쿠키 없음 → ${r6.status} (기대 401)`);
}

main()
  .catch((e) => {
    console.error('[error]', e instanceof Error ? e.message : e);
    checks.push({ name: '실행', pass: false, detail: String(e) });
  })
  .finally(async () => {
    // 정리 — 이 스크립트가 만든 사용자와 파생 데이터만 지운다.
    const emails = USERS.map((u) => u.email);
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    // Account·CleanupRequest·ScoreSnapshot·AccessLog는 전부 onDelete: Cascade라
    // User 한 줄을 지우면 파생이 함께 사라진다.
    const ids = users.map((u) => u.id);
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    const left = await prisma.user.count({ where: { email: { in: emails } } });
    console.log(`\n정리: 테스트 사용자 잔재 ${left}건`);

    const failed = checks.filter((c) => !c.pass);
    console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
    await prisma.$disconnect();
    process.exit(failed.length === 0 && checks.length > 0 ? 0 : 1);
  });
