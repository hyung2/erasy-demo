// prod가 지금 어떤 코드를 돌리는지 동적 경로로 판별한다 — 임시 사용자를 만들고 반드시 지운다.
//
// 판별 조건: 사용일이 전부 미상이고 미확인(discovered)인 계정만 가진 사용자.
//   구코드 → S축 미측정 (사용 이력이 0건이라 축을 버린다)
//   신코드 → S축 측정   (미인지 상태가 독립 관측이다)
//
// 정적 경로는 CDN 캐시(HIT, age 1100초+)라 배포 여부를 알 수 없다. /api/score는 동적이라
// 함수가 실제로 돌고, 그 응답이 곧 배포된 코드의 행동이다.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';

export {};

const BASE = (process.argv[2] ?? 'https://service-app-seven-virid.vercel.app').replace(/\/$/, '');
const prisma = new PrismaClient();
const ID = `uprobe-prodcode-${Date.now()}`;
const EMAIL = `${ID}@example.invalid`;
const PW = 'probe-prod-code-2026';

const jar = new Map<string, string>();
function absorb(res: Response): void {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookie = (): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function main(): Promise<void> {
  await prisma.user.create({
    data: {
      id: ID,
      email: EMAIL,
      name: '배포판별',
      passwordHash: await hashPassword(PW),
      // 유출 대조는 하지 않은 상태로 둔다 — E축을 끌어들이면 판별이 흐려진다.
    },
  });
  for (let i = 0; i < 3; i += 1) {
    await prisma.account.create({
      data: {
        id: `${ID}-a${i}`,
        userId: ID,
        name: `판별서비스${i}`,
        provider: 'manual',
        category: 'domestic',
        source: 'user_input',
        discovered: true, // 몰랐던 계정 — 신코드에서 S축을 살리는 신호
        // lastUsedAt 미지정 = null → 구코드에서는 축 전체가 미측정
      },
    });
  }

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

  const res = await fetch(`${BASE}/api/score`, { headers: { cookie: cookie() } });
  const body = (await res.json()) as {
    data?: { score?: number; axes?: Record<string, { measured?: boolean; score?: number | null }> };
  };
  const s = body.data?.axes?.surface;

  console.log(`x-vercel-cache: ${res.headers.get('x-vercel-cache') ?? '(없음 — 동적)'}`);
  console.log(`종합 ${body.data?.score} · S축 measured=${s?.measured} score=${s?.score}`);

  const checks: [boolean, string][] = [
    [res.status === 200, `1 점수 조회 200 (실제 ${res.status})`],
    [
      s?.measured === true,
      '2 미인지 관측만으로 S축을 잰다 — false면 배포된 코드가 옛것이거나 회귀했다',
    ],
    [typeof s?.score === 'number' && s.score < 100, `3 미인지 계정이 점수를 끌어내린다 (${s?.score})`],
  ];
  let passed = 0;
  for (const [ok, msg] of checks) {
    if (ok) passed += 1;
    else console.error(`  FAIL ${msg}`);
  }
  console.log(`verify-prod-surface-measured: ${passed} passed, ${checks.length - passed} failed`);
  if (passed < checks.length) process.exitCode = 1;
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.user.delete({ where: { id: ID } }).catch(() => {});
    const left = await prisma.user.count({ where: { id: ID } });
    console.log(`임시 사용자 잔여 ${left}건`);
    await prisma.$disconnect();
  });
