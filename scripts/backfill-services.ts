// 기존 계정을 Service로 연결한다(D3).
//
// 실행:
//   미리보기  pnpm exec tsx --env-file=.env scripts/backfill-services.ts
//   실제 적용  pnpm exec tsx --env-file=.env scripts/backfill-services.ts --apply
//
// 기본이 미리보기인 이유: 이 스크립트는 prod DB에 쓴다(prod·로컬 동일 Neon).
// 먼저 무엇이 어떻게 묶이는지 보고 나서 적용하는 편이, 묶고 나서 되돌리는 것보다 싸다.
//
// 되돌리기: Account.serviceId를 null로 돌리고 Service를 비우면 원상태다.
// rawName은 name의 복사본이므로 남아도 해가 없다.
import { PrismaClient } from '@prisma/client';
import { resolveServiceIdentity, ensureService } from '../lib/service-registry';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const accounts = await prisma.account.findMany({
    where: { serviceId: null },
    select: { id: true, name: true },
  });

  console.log(`대상 계정 ${accounts.length}건 (${APPLY ? '적용' : '미리보기'})`);

  let linked = 0;
  let skipped = 0;
  const bySlug = new Map<string, number>();

  for (const a of accounts) {
    const identity = resolveServiceIdentity(a.name);
    if (!identity) {
      // 발송 대행·인프라 도메인. 서비스로 만들지 않고 연결도 하지 않는다.
      skipped += 1;
      continue;
    }
    bySlug.set(identity.slug, (bySlug.get(identity.slug) ?? 0) + 1);

    if (APPLY) {
      const service = await ensureService(prisma, identity);
      await prisma.account.update({
        where: { id: a.id },
        // rawName에는 수집 원문을 그대로 넣는다. name은 화면 호환을 위해 손대지 않는다.
        data: { serviceId: service.id, rawName: a.name },
      });
    }
    linked += 1;
  }

  // 정규화가 실제로 무엇을 합쳤는지. 이 목록이 곧 "표기가 갈려 있던 서비스"다.
  const merged = [...bySlug.entries()].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1]);

  console.log(
    JSON.stringify(
      {
        linked,
        skipped,
        distinctServices: bySlug.size,
        mergedGroups: merged.length,
        topMerged: merged.slice(0, 10),
      },
      null,
      1,
    ),
  );

  if (!APPLY) console.log('\n미리보기입니다. 적용하려면 --apply 를 붙이세요.');
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
