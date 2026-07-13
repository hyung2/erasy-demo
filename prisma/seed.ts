// Prisma 시드(T2.2 코드분) — 기존 dummy-data 24계정을 source:'seed'로 DB 적재.
// 멱등: 고정 id upsert(재실행해도 drift 없음). 실행은 사용자 Neon 프로비저닝 후 `pnpm db:seed`.
// 자격증명 미저장 원칙 준수 — 비번/해시 없음, 점수 신호(breached·lastUsedAt)만.
import { PrismaClient } from '@prisma/client';
import type { Provider } from '@prisma/client';
import { accounts, breaches, type LinkMethod } from '../lib/dummy-data';

const prisma = new PrismaClient();

const DEMO_USER_ID = 'seed-user-demo';
const DEMO_USER_EMAIL = 'demo@erasy.app';

function toProvider(m: LinkMethod): Provider {
  if (m === 'email-password') return 'manual';
  return m.replace('-oauth', '') as Provider;
}

// lastUsedDays(상대일) → 절대 시각(스키마 정본은 lastUsedAt DateTime)
function lastUsedAt(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// dummy breachDate "2018-12"(월 정밀도) → 01일 정규화
function parseBreachDate(s: string): Date {
  return new Date(`${s}-01T00:00:00Z`);
}

async function main() {
  // 데모 사용자(멱등). 실 로그인 사용자와 구분되는 시드 계정.
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: { email: DEMO_USER_EMAIL, name: '김민준' },
    create: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: '김민준' },
  });

  // 24 계정 — 고정 id `seed-a01`… 로 멱등 upsert. 전부 source:'seed'.
  for (const a of accounts) {
    const id = `seed-${a.id}`;
    const data = {
      userId: DEMO_USER_ID,
      name: a.service,
      provider: toProvider(a.linkMethod),
      category: a.category,
      source: 'seed' as const,
      lastUsedAt: lastUsedAt(a.lastUsedDays),
      breached: a.breached,
    };
    await prisma.account.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  // 유출 이력 — 서비스명으로 계정 매칭(있으면 연결). 고정 id 멱등 upsert.
  for (const b of breaches) {
    const id = `seed-${b.id}`;
    const matched = accounts.find((a) => a.service === b.service);
    const accountId = matched ? `seed-${matched.id}` : null;
    const data = {
      userId: DEMO_USER_ID,
      accountId,
      service: b.service,
      breachDate: parseBreachDate(b.breachDate),
      exposedFields: b.exposedFields,
      advice: b.advice,
      severity: b.severity,
      resolved: b.resolved,
    };
    await prisma.breach.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  console.log(`seed done: user=${DEMO_USER_ID}, accounts=${accounts.length}, breaches=${breaches.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
