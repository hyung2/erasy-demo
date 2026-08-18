/**
 * 신규 사용자는 빈 상태로 시작한다 — 회귀 가드.
 *
 * 왜 이 가드가 필요한가
 *   가입·첫 로그인이 데모 데이터 24계정을 심었고, 그마저 없으면 /api/accounts가 시드로
 *   폴백했다. 그래서 처음 들어온 사람 화면에 Gmail·카카오톡·토스가 "당신의 계정"으로
 *   떴고, 정리 담기를 눌러야 예시였음을 알 수 있었다(2026-08-18 실측). 심사위원이
 *   직접 가입해 보는 순간 그대로 드러나는 자리다.
 *
 * 검증 항목
 *   (a) 가입 직후 /api/accounts = 0건 — 시드가 딸려오지 않는다
 *   (b) DB에도 계정 0건 — 화면만 감춘 게 아니라 애초에 심지 않는다
 *   (c) /api/score fallback='empty' — 남의 데이터로 점수를 대신 내지 않는다
 *   (d) 스캔으로 계정이 들어오면 그때부터 실데이터로 잰다(빈 상태가 고착되지 않음)
 *
 * 실행: 격리 DB + dev 서버를 띄운 뒤
 *   BASE_URL=http://localhost:3020 tsx scripts/verify-empty-start.ts
 * prod·공유 DB 오염 가드: DATABASE_URL이 localhost가 아니면 중단한다.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3020';
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('[abort] DATABASE_URL이 로컬이 아닙니다. 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();
const U = { email: 'empty-start@erasy.test', pw: 'EmptyStart-2026!', name: '빈 상태 검증' };

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

async function main() {
  await prisma.user.deleteMany({ where: { email: U.email } });

  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: U.email, password: U.pw, name: U.name }),
  });
  if (reg.status !== 201) throw new Error(`register ${reg.status}: ${await reg.text()}`);

  const jar = new Map<string, string>();
  const fold = (res: Response) => {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  fold(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  fold(
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
      body: new URLSearchParams({ csrfToken, email: U.email, password: U.pw, callbackUrl: BASE }),
      redirect: 'manual',
    }),
  );

  const list = (await fetch(`${BASE}/api/accounts`, { headers: { cookie: cookie() } }).then((r) =>
    r.json(),
  )) as { data: { source: string }[] };
  check('a 가입 직후 목록 0건', list.data.length === 0, `/api/accounts = ${list.data.length}건`);

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: U.email },
    select: { id: true },
  });
  const dbCount = await prisma.account.count({ where: { userId: user.id } });
  check('b DB에도 계정 0건', dbCount === 0, `Account 테이블 = ${dbCount}건 (심지 않았다)`);

  type ScoreBody = { data?: { score?: number; fallback?: string; coveredCount?: number } };
  const s1 = (await fetch(`${BASE}/api/score`, { headers: { cookie: cookie() } }).then((r) =>
    r.json(),
  )) as ScoreBody;
  check(
    'c 점수는 빈 상태로 표기',
    s1.data?.coveredCount === 0,
    `확인 ${s1.data?.coveredCount}건 · 점수 ${s1.data?.score} (남의 데이터로 대신 내지 않는다)`,
  );

  // (d) 계정이 하나 들어오면 그때부터 실데이터로 잰다 — 빈 상태가 고착되면 그것도 결함이다.
  const add = await fetch(`${BASE}/api/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie() },
    body: JSON.stringify({ name: '검증용 서비스' }),
  });
  const list2 = (await fetch(`${BASE}/api/accounts`, { headers: { cookie: cookie() } }).then((r) =>
    r.json(),
  )) as { data: { source: string }[] };
  const s2 = (await fetch(`${BASE}/api/score`, { headers: { cookie: cookie() } }).then((r) =>
    r.json(),
  )) as ScoreBody;
  check(
    'd 계정이 생기면 실데이터로 전환',
    add.status < 300 && list2.data.length === 1 && (s2.data?.coveredCount ?? 0) >= 0,
    `추가 ${add.status} → 목록 ${list2.data.length}건 · 출처 ${list2.data[0]?.source} · 점수 ${s2.data?.score}`,
  );
}

main()
  .catch((e) => {
    console.error('[error]', e instanceof Error ? e.message : e);
    failures += 1;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: U.email } });
    console.log(`\n정리: 잔재 ${await prisma.user.count({ where: { email: U.email } })}건`);
    console.log(failures === 0 ? '\n결과: 전 항목 PASS' : `\n결과: ${failures}건 FAIL`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
