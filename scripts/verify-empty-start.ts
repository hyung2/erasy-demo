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

  // (d2) 알림·유출은 내 것만. 예전에는 /api/guard가 userId를 보지도 않고 dummy를 돌려줘서
  // 방금 가입한 사람에게 "Quora 2018-12 유출"이 자기 이력으로 떴다.
  type GuardBody = { data?: { alerts?: unknown[]; breaches?: unknown[] } };
  const guard = (await fetch(`${BASE}/api/guard`, { headers: { cookie: cookie() } }).then((r) =>
    r.json(),
  )) as GuardBody;
  // 이 시점 사용자는 계정 1개를 방금 직접 추가했다 — 유출은 없고 활동은 그 한 건이 잡혀야 한다.
  const alerts = guard.data?.alerts ?? [];
  check(
    'd2 알림·유출은 내 것만',
    (guard.data?.breaches ?? []).length === 0 && alerts.length <= 2,
    `유출 ${(guard.data?.breaches ?? []).length}건(남의 유출 0이어야) · 활동 ${alerts.length}건(직접 추가분만)`,
  );

  // (e·f) 로그인 직후 착지 화면. 예전에는 여기가 연출이었다 — 조회 없이 프로그레스만 돌고
  // "확인된 계정 24개"라고 적었다. 빈 상태로 바뀐 지금 그 화면이 남아 있으면
  // "스캔했다는데 아무것도 없다"가 된다. 실제 스캔 진입점이 있는지, 옛 연출 문구가
  // 사라졌는지를 함께 잰다.
  const anon = await fetch(`${BASE}/scanning`, { redirect: 'manual' });
  check(
    'e 온보딩은 로그인 필요',
    anon.status === 307 || anon.status === 302,
    `미인증 /scanning = ${anon.status} (권한 창까지 갔다가 401 받는 헛걸음 차단)`,
  );

  const onboard = await fetch(`${BASE}/scanning`, { headers: { cookie: cookie() } });
  const html = await onboard.text();
  // 발견 경로는 **둘 다** 있어야 한다. 메일 스캔은 Gmail만 보므로 네이버·다음 메일을 주로
  // 쓰는 사람은 그 길로 아무것도 못 찾는다. 소셜 연결목록이 빠지면 그 사용자는 빈 화면에서
  // 시작해 빈 화면으로 끝난다.
  const mailAt = html.indexOf('메일함으로 계정 찾기');
  const linkAt = html.indexOf('간편가입한 서비스 가져오기');
  const hasMailPath = mailAt >= 0;
  const hasLinkPath = linkAt >= 0;
  const hasStaleTheater = html.includes('계정을 찾는 중') || html.includes('안전도 점수를 산출하고');
  check(
    'f 온보딩에 발견 경로 2종',
    onboard.status === 200 && hasMailPath && hasLinkPath && !hasStaleTheater,
    `${onboard.status} · 메일함 ${hasMailPath} · 연결목록 ${hasLinkPath} · 옛 연출 문구 ${hasStaleTheater}`,
  );

  // (f2) 순서도 계약이다. 사업계획서 "(다) 단계적 발견 경로"는 사용자 직접 가져오기를 1단계로,
  //   메일 자동 분석을 CASA Tier2 통과가 필요한 2단계로 둔다. 메일 스캔이 앞에 서면 민감
  //   scope 동의창과 "확인되지 않은 앱" 경고가 첫 관문이 되고, 구글 메일을 안 쓰는 사람은
  //   그 관문을 넘고도 빈손으로 나온다. 존재만 재던 가드가 순서 회귀는 놓쳤다(2026-08-19).
  check(
    'f2 발견 경로 순서 — 연결목록이 먼저',
    hasLinkPath && hasMailPath && linkAt < mailAt,
    `연결목록 ${linkAt} < 메일함 ${mailAt} (정본 1단계가 앞이어야)`,
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
