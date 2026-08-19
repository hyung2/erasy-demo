/**
 * 연결 해제 왕복 — 회귀 가드.
 *
 * 무엇을 지키는가
 *   제품의 후반부는 "찾아서 담기"가 아니라 "가서 끊고 와서 정리를 닫기"다. 그 절반이 오래
 *   비어 있었다. /api/cleanup/mark는 입력을 되돌려 주기만 하는 스텁이었고, 연결목록 가져오기는
 *   목록에 **있는** 것만 봤다. 그래서 회복 규칙(score-v2의 removed → 전 축에서 계정 제외)이
 *   구현돼 있는데도 한 번도 발화하지 못했고, 화면은 늘 "정리하면 오를 예정"에서 멈췄다.
 *
 * 검증 항목
 *   (a) 1차 가져오기 — 연결목록이 계정으로 들어오고 provider가 사실로 기록된다
 *   (b) 재가져오기에 사라진 항목이 잡힌다 — 끊고 온 것이 후보로 올라온다
 *   (c) 자동 확정하지 않는다 — 확인 전에는 점수도 계정 상태도 그대로다
 *   (d) 확인하면 완료로 닫힌다 — CleanupRequest가 done + completedAt
 *   (e) 점수가 실제로 오른다 — 회복 규칙이 발화한다
 *   (f) 체크 해제분 오판 방어 — 담지 않기로 한 항목이 "끊긴 것"이 되지 않는다
 *   (g) 소유권 — 남의 계정은 mark로 닫을 수 없다
 *   (h) 재확인 멱등 — 이미 닫은 계정을 또 묻지 않는다
 *
 * 실행: 격리 DB + dev 서버를 띄운 뒤
 *   BASE_URL=http://localhost:3020 pnpm exec tsx scripts/verify-revoke-roundtrip.ts
 * prod·공유 DB 오염 가드: DATABASE_URL이 localhost가 아니면 중단한다.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.BASE_URL ?? 'http://localhost:3020';
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('[abort] DATABASE_URL이 로컬이 아닙니다. 격리 DB에서만 실행하십시오.');
  process.exit(1);
}

const prisma = new PrismaClient();
const A = { email: 'revoke-a@erasy.test', pw: 'RevokeRound-2026!', name: '왕복 검증 A' };
const B = { email: 'revoke-b@erasy.test', pw: 'RevokeRound-2026!', name: '왕복 검증 B' };

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

type Jar = Map<string, string>;
function cookieOf(jar: Jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function login(u: typeof A): Promise<Jar> {
  const jar: Jar = new Map();
  const fold = (res: Response) => {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.pw, name: u.name }),
  });
  if (reg.status !== 201) throw new Error(`register ${reg.status}: ${await reg.text()}`);

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  fold(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  fold(
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieOf(jar) },
      body: new URLSearchParams({ csrfToken, email: u.email, password: u.pw, callbackUrl: BASE }),
      redirect: 'manual',
    }),
  );
  return jar;
}

type ImportData = {
  createdCount: number;
  upgradedCount: number;
  unchangedCount: number;
  missing: Array<{ accountId: string; name: string }>;
};

async function importList(
  jar: Jar,
  provider: string,
  names: string[],
  allNames?: string[],
): Promise<ImportData> {
  const res = await fetch(`${BASE}/api/accounts/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieOf(jar) },
    body: JSON.stringify({ provider, names, allNames: allNames ?? names }),
  });
  const json = (await res.json()) as { ok: boolean; data?: ImportData; error?: string };
  if (!json.ok || !json.data) throw new Error(`import 실패: ${json.error ?? res.status}`);
  return json.data;
}

async function scoreOf(jar: Jar): Promise<number> {
  const r = (await fetch(`${BASE}/api/score`, { headers: { cookie: cookieOf(jar) } }).then((x) =>
    x.json(),
  )) as { data?: { score?: number } };
  return r.data?.score ?? -1;
}

async function mark(jar: Jar, accountId: string, actionType = 'revoke', status = 'done') {
  return fetch(`${BASE}/api/cleanup/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieOf(jar) },
    body: JSON.stringify({ accountId, actionType, status }),
  });
}

// 첫 회차 목록. 이 중 2개를 "끊고 온" 것으로 다룬다.
const ROUND1 = ['넷플릭스', '스포티파이', '디스코드', '노션', '피그마'];
const REVOKED = ['디스코드', '노션'];
const ROUND2 = ROUND1.filter((n) => !REVOKED.includes(n));

async function main() {
  await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
  const jarA = await login(A);
  const jarB = await login(B);

  // (a) 1차 가져오기
  const r1 = await importList(jarA, 'google', ROUND1);
  const userA = await prisma.user.findUniqueOrThrow({
    where: { email: A.email },
    select: { id: true },
  });
  const googleCount = await prisma.account.count({
    where: { userId: userA.id, provider: 'google' },
  });
  check(
    'a 1차 가져오기 — provider가 사실로 기록',
    r1.createdCount === ROUND1.length && googleCount === ROUND1.length && r1.missing.length === 0,
    `생성 ${r1.createdCount}건 · google ${googleCount}건 · 사라짐 ${r1.missing.length}건(첫 회차라 0이어야)`,
  );

  // 픽스처 — 끊을 대상에 미해결 유출을 심는다.
  //
  // 왜 필요한가: 연결목록으로 들어온 계정은 활동일도 위생 신호도 없어(social_link는 위생
  // 관측 출처가 아니다) 위험 인자가 하나도 없다. 그런 계정만 있으면 점수는 100이고,
  // 계정을 빼도 100이다 — 그게 "규모 무감점" 원칙이 작동하는 정상 상태다.
  // 실제로 사람이 연결을 끊는 계정은 유출됐거나 방치된 계정이다. 회복이 발화하는지 재려면
  // 재는 대상이 회복될 것이 있는 계정이어야 한다.
  const revokedRows = await prisma.account.findMany({
    where: { userId: userA.id, name: { in: REVOKED } },
    select: { id: true, name: true },
  });
  await prisma.breach.createMany({
    data: revokedRows.map((r) => ({
      userId: userA.id,
      accountId: r.id,
      service: r.name,
      breachDate: new Date('2024-03-01'),
      exposedFields: ['이메일', '비밀번호'],
      advice: '비밀번호를 변경하고 연결을 끊으세요.',
      severity: 'high' as const,
      resolved: false,
    })),
  });
  await prisma.account.updateMany({
    where: { id: { in: revokedRows.map((r) => r.id) } },
    data: { breached: true },
  });

  const scoreBefore = await scoreOf(jarA);
  check(
    'a2 픽스처 — 유출 계정이 점수를 끌어내린다',
    scoreBefore < 100,
    `유출 2건 반영 후 점수 ${scoreBefore} (100 미만이어야 회복 여지가 생긴다)`,
  );

  // (b) 재가져오기 — 끊고 온 2개가 후보로 잡힌다
  const r2 = await importList(jarA, 'google', ROUND2);
  const missingNames = r2.missing.map((m) => m.name).sort();
  check(
    'b 사라진 항목이 후보로 잡힌다',
    missingNames.length === REVOKED.length &&
      missingNames.join(',') === [...REVOKED].sort().join(','),
    `후보 [${missingNames.join(', ')}] (기대 [${[...REVOKED].sort().join(', ')}])`,
  );

  // (c) 확인 전에는 아무것도 확정되지 않는다
  const doneBefore = await prisma.cleanupRequest.count({
    where: { userId: userA.id, status: 'done' },
  });
  const scoreAfterDetect = await scoreOf(jarA);
  check(
    'c 확인 전에는 확정하지 않는다',
    doneBefore === 0 && scoreAfterDetect === scoreBefore,
    `완료 ${doneBefore}건 · 점수 ${scoreBefore} → ${scoreAfterDetect} (사용자 확인 전 불변)`,
  );

  // (d) 확인 → 완료로 닫힌다
  const markRes = await Promise.all(r2.missing.map((m) => mark(jarA, m.accountId)));
  const okCount = markRes.filter((r) => r.ok).length;
  const closed = await prisma.cleanupRequest.findMany({
    where: { userId: userA.id, status: 'done', actionType: 'revoke' },
    select: { accountId: true, completedAt: true },
  });
  check(
    'd 확인하면 완료로 닫힌다',
    okCount === REVOKED.length &&
      closed.length === REVOKED.length &&
      closed.every((c) => c.completedAt !== null),
    `mark 성공 ${okCount}건 · done ${closed.length}건 · completedAt 전건 기록 ${closed.every((c) => c.completedAt !== null)}`,
  );

  // (e) 점수가 실제로 오른다 — 회복 규칙 발화
  const scoreAfter = await scoreOf(jarA);
  check(
    'e 정리 완료가 점수에 반영된다',
    scoreAfter > scoreBefore,
    `${scoreBefore} → ${scoreAfter} (removed 규칙이 발화해야 오른다)`,
  );

  // (f) 체크 해제분 오판 방어 — 담지 않기로 한 항목이 "끊긴 것"이 되면 안 된다.
  //     names에서는 빼고 allNames에는 남긴다 = 화면에서 체크만 해제한 상황.
  const r3 = await importList(jarA, 'google', ['넷플릭스'], ROUND2);
  check(
    'f 체크 해제분은 끊긴 것이 아니다',
    r3.missing.length === 0,
    `사라짐 ${r3.missing.length}건 (담지 않기로 한 ${ROUND2.length - 1}건은 후보에 오르면 안 됨)`,
  );

  // (g) 소유권 — B가 A의 계정을 닫을 수 없다
  const aAccount = await prisma.account.findFirstOrThrow({
    where: { userId: userA.id },
    select: { id: true },
  });
  const cross = await mark(jarB, aAccount.id);
  const stillOwned = await prisma.cleanupRequest.count({
    where: { accountId: aAccount.id, userId: (await prisma.user.findUniqueOrThrow({
      where: { email: B.email }, select: { id: true },
    })).id },
  });
  check(
    'g 남의 계정은 닫을 수 없다',
    cross.status === 404 && stillOwned === 0,
    `B → A 계정 mark = ${cross.status} (기대 404) · B 명의 요청 ${stillOwned}건`,
  );

  // (h) 재확인 멱등 — 이미 닫은 계정을 또 묻지 않는다
  const r4 = await importList(jarA, 'google', ROUND2);
  check(
    'h 이미 닫은 계정은 다시 묻지 않는다',
    r4.missing.length === 0,
    `사라짐 ${r4.missing.length}건 (완료 처리된 ${REVOKED.length}건이 재등장하면 안 됨)`,
  );
}

main()
  .catch((e) => {
    console.error('[error]', e instanceof Error ? e.message : e);
    failures += 1;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
    console.log(failures === 0 ? '\n결과: 전 항목 PASS' : `\n결과: ${failures}건 FAIL`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
