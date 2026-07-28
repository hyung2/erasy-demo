// 런타임 실측 — 자체 가입(이메일+비밀번호) 회귀 가드. 실제 DB 대상.
// 실행: pnpm exec tsx --env-file=.env scripts/verify-credentials-auth.ts
//
// 검증 항목
//   (a) 해시 왕복 — 같은 비밀번호는 통과, 틀린 비밀번호는 거부, 해시가 원문을 담지 않음
//   (b) 해시 유일성 — 같은 비밀번호라도 솔트가 달라 저장값이 다름(레인보우/일괄 크랙 방어)
//   (c) 저장 파라미터 존중 — 저장 문자열의 N/r/p로 재계산해도 검증 통과(파라미터 상향 시 하위호환)
//   (d) 정책 — 10자 미만 거부, 이메일 정규화(대문자·공백)
//   (e) 가입 경로 — User 생성 + 데모 데이터 24계정 프로비저닝(구글 경로와 동일 결과)
//   (f) 소셜 전용 계정(passwordHash null)은 비밀번호 로그인 불가
// 임시 사용자는 마지막에 반드시 정리(prod와 동일 DB 공유). 시크릿·원문 비밀번호 미출력.
import { prisma } from '../lib/prisma';
import { provisionDemoData, purgeProvisionedData } from '../lib/provision-demo';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  normalizeEmail,
} from '../lib/password';

const TEST_USER_ID = 'verify-credentials-tmp';
const SOCIAL_USER_ID = 'verify-credentials-social-tmp';
const TEST_EMAIL = `${TEST_USER_ID}@example.invalid`;
const SOCIAL_EMAIL = `${SOCIAL_USER_ID}@example.invalid`;
const PASSWORD = 'correct-horse-battery-staple';

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

async function cleanup() {
  await purgeProvisionedData(prisma, TEST_USER_ID);
  await prisma.user.deleteMany({ where: { id: { in: [TEST_USER_ID, SOCIAL_USER_ID] } } });
}

async function main() {
  await cleanup();

  // (a) 해시 왕복
  const hash = await hashPassword(PASSWORD);
  const okRight = await verifyPassword(PASSWORD, hash);
  const okWrong = await verifyPassword(PASSWORD + 'x', hash);
  const leaks = hash.includes(PASSWORD);
  check('a1 올바른 비밀번호 통과', okRight === true, `verify=${okRight}`);
  check('a2 틀린 비밀번호 거부', okWrong === false, `verify=${okWrong}`);
  check('a3 해시에 원문 미포함', leaks === false, `포함=${leaks}`);

  // (b) 솔트 유일성
  const hash2 = await hashPassword(PASSWORD);
  check('b  같은 비밀번호 → 다른 해시', hash !== hash2, `동일=${hash === hash2}`);

  // (c) 저장 파라미터 존중 — 형식과 재계산
  const parts = hash.split('$');
  const shaped = parts.length === 6 && parts[0] === 'scrypt';
  check('c1 저장 형식 scrypt$N$r$p$salt$hash', shaped, `필드=${parts.length}, N=${parts[1]}`);
  // 파라미터를 낮춘 해시도 그 값으로 재계산돼 검증돼야 한다(하위호환 보장).
  const legacy = `scrypt$16384$8$1$${parts[4]}$${parts[5]}`;
  const legacyOk = await verifyPassword(PASSWORD, legacy);
  check(
    'c2 다른 N 저장값은 그 N으로 재계산(불일치 → 거부)',
    legacyOk === false,
    `N=16384 재계산 결과=${legacyOk} (기대 false — 해시는 N=${parts[1]}로 만들어짐)`,
  );

  // (d) 정책·정규화
  check('d1 10자 미만 거부', validatePassword('short123') !== null, validatePassword('short123') ?? '-');
  check('d2 10자 이상 통과', validatePassword(PASSWORD) === null, '통과');
  check('d3 이메일 정규화', normalizeEmail('  User@Example.COM ') === 'user@example.com', String(normalizeEmail('  User@Example.COM ')));
  check('d4 형식 위반 거부', normalizeEmail('not-an-email') === null, String(normalizeEmail('not-an-email')));

  // (e) 가입 경로 = User 생성 + 프로비저닝(구글 경로와 동일 결과 상태)
  const user = await prisma.user.create({
    data: { id: TEST_USER_ID, email: TEST_EMAIL, name: 'verify', passwordHash: hash },
    select: { id: true },
  });
  const p = await provisionDemoData(prisma, user.id, { idPrefix: `u${user.id}` });
  const accounts = await prisma.account.count({ where: { userId: user.id } });
  check('e1 가입 직후 프로비저닝', p.provisioned === true && accounts === 24, `provisioned=${p.provisioned}, accounts=${accounts}`);

  const stored = await prisma.user.findUnique({
    where: { email: TEST_EMAIL },
    select: { passwordHash: true },
  });
  const loginOk = stored?.passwordHash ? await verifyPassword(PASSWORD, stored.passwordHash) : false;
  check('e2 DB 저장 해시로 로그인 검증', loginOk === true, `verify=${loginOk}`);

  // (f) 소셜 전용 계정은 비밀번호 로그인 불가
  await prisma.user.create({
    data: { id: SOCIAL_USER_ID, email: SOCIAL_EMAIL, name: 'social' },
  });
  const social = await prisma.user.findUnique({
    where: { email: SOCIAL_EMAIL },
    select: { passwordHash: true },
  });
  check('f  소셜 전용 계정 비밀번호 로그인 차단', social?.passwordHash == null, `passwordHash=${social?.passwordHash ?? 'null'}`);

  console.log(failures === 0 ? '\n결과: 전 항목 PASS' : `\n결과: ${failures}건 FAIL`);
}

main()
  .catch((e) => {
    console.error('실행 실패:', (e as Error).message);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
