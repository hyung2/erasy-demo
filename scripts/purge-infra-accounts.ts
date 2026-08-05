// 발송 대행 도메인으로 잘못 담긴 계정 정리 — 개방 모드(A1) 도입 전 스캔이 남긴 오염분.
//
// 왜 필요한가: A1 첫 배포는 발송 대행 도메인을 걸러내지 않아 `amazonaws.com`·`shopifyemail.com`
// 같은 항목이 계정으로 저장됐다. 판정은 이후 커밋에서 고쳤지만 **이미 저장된 행은 그대로**다.
// 이 스크립트가 그것만 골라 지운다.
//
// 기본은 **드라이런**(무엇을 지울지 보여주기만 함). 실제 삭제는 --apply.
// 실행: pnpm exec tsx --env-file=.env scripts/purge-infra-accounts.ts [--apply] [--user <id>]
//
// 안전장치
//   - `source: 'mail_scan'`인 행만 본다. 사용자가 직접 추가하거나 시드로 들어온 계정은 건드리지 않는다.
//   - 판정은 `isInfraDomain` 하나만 쓴다(코드와 같은 기준 — 스크립트가 별도 규칙을 갖지 않는다).
//   - 대상 목록을 전부 출력한 뒤에만 지운다.
import { prisma } from '../lib/prisma';
import { isInfraDomain } from '../lib/gmail-catalog';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const userIdx = args.indexOf('--user');
const ONLY_USER = userIdx >= 0 ? args[userIdx + 1] : null;

async function main() {
  const rows = await prisma.account.findMany({
    where: { source: 'mail_scan', ...(ONLY_USER ? { userId: ONLY_USER } : {}) },
    select: { id: true, userId: true, name: true, createdAt: true },
    orderBy: { name: 'asc' },
  });

  const targets = rows.filter((r) => isInfraDomain(r.name));

  console.log(`mail_scan 계정 ${rows.length}건 중 발송 대행 도메인 ${targets.length}건`);
  if (targets.length === 0) {
    console.log('정리할 대상이 없습니다.');
    return;
  }

  const byUser = new Map<string, string[]>();
  for (const t of targets) {
    const list = byUser.get(t.userId) ?? [];
    list.push(t.name);
    byUser.set(t.userId, list);
  }
  for (const [uid, names] of byUser) {
    console.log(`  user ${uid.slice(0, 10)}… — ${names.length}건: ${names.join(', ')}`);
  }

  if (!APPLY) {
    console.log('');
    console.log('드라이런입니다. 실제로 지우려면 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  const res = await prisma.account.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } });
  console.log('');
  console.log(`삭제 완료: ${res.count}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
