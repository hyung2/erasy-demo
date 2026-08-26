// 배포된 코드에서 "정직한 자가신고"가 실제로 기록되는지 — 임시 사용자를 만들고 반드시 지운다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/verify-prod-selfreport.ts [https://...]
//
// 판별 조건: **재사용 아니오 · 2FA 아니오**로 신고한다. 둘 다 false다.
//   옛 코드 → 신고 여부를 값으로 짐작하므로 관측 0건, 위생축 미측정
//   새 코드 → 답했다는 사실(selfReportedAt)을 기록하므로 분모에 편입
//
// 왜 이 조합을 고르는가: 위생이 좋은 사용자의 답이 바로 이 조합이고, 옛 코드에서는 그 답이
// 통째로 사라졌다. 사용자가 축을 켜려면 "예"라고 답해야 하는 압력이 생기는데, 그건 이 제품이
// 팔지 않기로 한 것이다. 그래서 이 검사는 배포 확인이면서 동시에 제품 원칙의 가드다.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';

export {};

const BASE = (process.argv[2] ?? 'https://service-app-seven-virid.vercel.app').replace(/\/$/, '');
const prisma = new PrismaClient();
const ID = `uprobe-selfreport-${Date.now()}`;
const EMAIL = `${ID}@example.invalid`;
const PW = 'probe-selfreport-2026';

const jar = new Map<string, string>();
function absorb(res: Response): void {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookie = (): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function hygiene(): Promise<{ measured: boolean; covered: number; score: number | null }> {
  const res = await fetch(`${BASE}/api/score`, { headers: { cookie: cookie() } });
  const b = (await res.json()) as {
    data?: { axes?: { hygiene?: { measured: boolean; coveredCount: number; score: number | null } } };
  };
  const h = b.data?.axes?.hygiene;
  return { measured: h?.measured ?? false, covered: h?.coveredCount ?? 0, score: h?.score ?? null };
}

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

async function main(): Promise<void> {
  await prisma.user.create({
    data: { id: ID, email: EMAIL, name: '신고기록 확인', passwordHash: await hashPassword(PW) },
  });
  // 직접 추가 계정 — 수집 경로가 없으므로 허용목록 밖이다. 신고만이 관측의 유일한 근거다.
  const acc = await prisma.account.create({
    data: {
      id: `${ID}-a0`,
      userId: ID,
      name: '신고확인서비스',
      provider: 'manual',
      category: 'domestic',
      source: 'user_input',
      lastUsedAt: new Date(),
    },
    select: { id: true },
  });

  const { csrfToken } = (await (await fetch(`${BASE}/api/auth/csrf`).then((r) => {
    absorb(r);
    return r;
  })).json()) as { csrfToken: string };
  absorb(
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
      body: new URLSearchParams({ email: EMAIL, password: PW, csrfToken, callbackUrl: `${BASE}/dashboard` }),
      redirect: 'manual',
    }),
  );

  const before = await hygiene();
  check(!before.measured && before.covered === 0, `1 신고 전에는 미측정 (covered=${before.covered})`);

  // 정직한 답 — 고유 비밀번호를 쓰고 2단계 인증은 안 켰다. 둘 다 false다.
  const patch = await fetch(`${BASE}/api/accounts/${acc.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookie() },
    body: JSON.stringify({ passwordReused: false, twoFactorEnabled: false }),
  });
  check(patch.ok, `2 자가신고 PATCH 통과 (${patch.status})`);

  const after = await hygiene();
  check(
    after.measured && after.covered === 1,
    `3 "아니오·아니오"도 관측으로 기록된다 (measured=${after.measured} covered=${after.covered})`,
  );
  check(
    after.score !== null && after.score > 0,
    `4 고유 비밀번호가 점수에 반영된다 (${after.score})`,
  );

  const row = await prisma.account.findUnique({
    where: { id: acc.id },
    select: { selfReportedAt: true },
  });
  check(row?.selfReportedAt != null, `5 신고 시각이 DB에 남는다 (${row?.selfReportedAt ?? 'null'})`);

  console.log(`verify-prod-selfreport: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.user.delete({ where: { id: ID } }).catch(() => {});
    const left = await prisma.user.count({ where: { id: ID } });
    console.log(`임시 사용자 잔여 ${left}건`);
    await prisma.$disconnect();
  });
