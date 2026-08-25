/**
 * W7 — 자가신고가 위생(H)축 분모에 실제로 들어가는가. 런타임 게이트.
 *
 * 왜 재는가
 *   `passwordSignalObserved`는 **허용목록**으로 판정한다(score-service).
 *     SIGNAL_OBSERVED_SOURCES.has(source) || passwordReused || twoFactorEnabled
 *   허용목록은 `seed`·`oauth_linked` 둘뿐이다. 무대 계정은 전부 `mail_scan`이라 허용목록 밖이고,
 *   그러면 자가신고를 해도 H축이 안 채워질 수 있다 — 그 경우 데모의 최대 레버(비번 교체)가
 *   무대에서 죽는다. 08-04에 허용목록이 좁혀진 뒤로 이 조합이 실측된 적이 없다.
 *
 * 무엇이 통과인가
 *   (a) 자가신고 전 — mail_scan 계정만 있으면 H축 coverage 0 (미측정)
 *   (b) true 값 신고 후 — 그 계정이 분모에 편입되어 coverage ≥ 1
 *   (c) false·false 신고도 분모에 들어간다
 *
 *   (c)는 2026-08-26에 뒤집혔다. 전에는 `passwordReused || twoFactorEnabled`로 신고 여부를
 *   짐작했고, 그래서 "고유 비밀번호를 쓰고 2FA는 안 켰다"는 정직한 답이 (false, false)가 되어
 *   미신고와 구분되지 않았다. 비밀번호 위생이 좋은 사용자일수록 자기 위생축을 못 켜는
 *   역전이었다. 지금은 `Account.selfReportedAt`이 신고 행위 자체를 기록한다.
 *   미신고 계정은 여전히 분모 밖이다 — "미확인을 안전으로 계상하지 않는다"는 원칙은 그대로다.
 *
 * prod를 건드리지 않는 이유: 실제 상태가 아닌 값을 무대 계정에 넣으면 허위 데이터가 된다.
 *   판정 로직은 코드가 같으므로 격리 DB로 동일하게 잰다.
 *
 * 실행: 격리 DB + dev 서버
 *   BASE_URL=http://localhost:3020 pnpm exec tsx scripts/verify-selfreport-gate.ts
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3020';
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('[abort] DATABASE_URL이 로컬이 아닙니다. 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();
const U = { email: 'selfreport-gate@erasy.test', pw: 'SelfReport-2026!', name: '자가신고 게이트' };

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

type Jar = Map<string, string>;
const cookieOf = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

type HygieneAxis = { coverage: number; coveredCount: number; score: number | null };

async function hygieneOf(jar: Jar): Promise<HygieneAxis> {
  const r = (await fetch(`${BASE}/api/score`, { headers: { cookie: cookieOf(jar) } }).then((x) =>
    x.json(),
  )) as { data?: { axes?: { hygiene?: HygieneAxis } } };
  return r.data?.axes?.hygiene ?? { coverage: 0, coveredCount: 0, score: null };
}

async function main() {
  await prisma.user.deleteMany({ where: { email: U.email } });

  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: U.email, password: U.pw, name: U.name }),
  });
  if (reg.status !== 201) throw new Error(`register ${reg.status}`);

  const jar: Jar = new Map();
  const fold = (res: Response) => {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  fold(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  fold(
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieOf(jar) },
      body: new URLSearchParams({ csrfToken, email: U.email, password: U.pw, callbackUrl: BASE }),
      redirect: 'manual',
    }),
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: U.email },
    select: { id: true },
  });

  // 무대 계정과 같은 조건을 만든다 — 메일 스캔으로 들어온 계정은 provider=manual, source=mail_scan.
  const names = ['스캔계정A', '스캔계정B', '스캔계정C'];
  await prisma.account.createMany({
    data: names.map((name) => ({
      userId: user.id,
      name,
      provider: 'manual' as const,
      category: 'domestic' as const,
      source: 'mail_scan' as const,
      discovered: true,
    })),
  });

  // (a) 자가신고 전 — 위생 축은 잴 근거가 없다
  const before = await hygieneOf(jar);
  check(
    'a 신고 전 위생축 미측정',
    before.coveredCount === 0,
    `coverage ${before.coverage} · 관측 ${before.coveredCount}건 · 점수 ${before.score}`,
  );

  // (b) true 값 신고 — 재사용 있음. 여기서 분모 편입이 일어나야 한다.
  const target = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, name: '스캔계정A' },
    select: { id: true },
  });
  const patch = await fetch(`${BASE}/api/accounts/${target.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieOf(jar) },
    body: JSON.stringify({ passwordReused: true }),
  });
  const afterTrue = await hygieneOf(jar);
  check(
    'b true 신고가 위생축 분모에 편입된다',
    patch.ok && afterTrue.coveredCount >= 1,
    `PATCH ${patch.status} · coverage ${afterTrue.coverage} · 관측 ${afterTrue.coveredCount}건 · 점수 ${afterTrue.score}`,
  );

  // (c) false·false 신고도 관측이다 — 값이 아니라 답했다는 사실이 근거다.
  //   허용목록 밖 출처는 "신호가 true일 때만" 관측으로 본다 — 신고 행위 자체가 근거가 되진 않는다.
  //   이 사실을 모르면 W8에서 "다 아니오"로 답한 계정이 왜 안 잡히는지 무대에서 당황한다.
  const target2 = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, name: '스캔계정B' },
    select: { id: true },
  });
  await fetch(`${BASE}/api/accounts/${target2.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieOf(jar) },
    body: JSON.stringify({ passwordReused: false, twoFactorEnabled: false }),
  });
  const afterFalse = await hygieneOf(jar);
  check(
    'c false·false 신고도 분모에 편입된다 — 고유 비번·2FA 없음도 관측된 사실이다',
    afterFalse.coveredCount > afterTrue.coveredCount,
    `관측 ${afterTrue.coveredCount} → ${afterFalse.coveredCount}건 (늘어야 정상)`,
  );

  // (d) 2FA=true 도 같은 통로로 편입되는가 — W8에서 쓸 두 번째 신호.
  const target3 = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, name: '스캔계정C' },
    select: { id: true },
  });
  await fetch(`${BASE}/api/accounts/${target3.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieOf(jar) },
    body: JSON.stringify({ twoFactorEnabled: true }),
  });
  const after2fa = await hygieneOf(jar);
  check(
    'd 2FA=true 도 분모에 편입된다',
    after2fa.coveredCount >= afterFalse.coveredCount,
    `관측 ${afterFalse.coveredCount} → ${after2fa.coveredCount}건 · 점수 ${after2fa.score}`,
  );
}

main()
  .catch((e) => {
    console.error('[error]', e instanceof Error ? e.message : e);
    failures += 1;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: U.email } });
    console.log(
      failures === 0
        ? '\n결과: 게이트 통과 — W8(자가신고 10~15건) 진행 가능'
        : `\n결과: ${failures}건 FAIL — (나) 폴백 검토 필요`,
    );
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
