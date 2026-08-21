// 수집 경로가 서비스 정규화를 빠뜨리지 않았는지 소스에서 확인한다(D4).
//
// 실행: pnpm exec tsx scripts/verify-service-wiring.ts
//
// 왜 소스를 읽는 가드인가
//   빠뜨림은 런타임에 예외를 내지 않는다. 계정은 정상적으로 저장되고 화면도 멀쩡하며,
//   그저 serviceId가 비어 있을 뿐이다. 집계를 돌려 보기 전까지 아무도 모르고, 그때는
//   이미 데이터가 두 갈래로 갈려 있다. 새 수집 경로가 생기는 순간에 잡아야 한다.
//
//   같은 이유로 "계정을 만드는 곳"을 스스로 찾는다. 목록을 손으로 적어 두면 새 경로가
//   추가돼도 목록이 갱신되지 않아 가드가 조용히 통과한다(08-04 거부 목록이 뚫린 자리).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

const ROOTS = ['app', 'lib'];
/** 시드 프로비저닝은 정규화 대상이 아니다 — 가상 인물의 이력이라 집계에 넣지 않는다. */
const EXEMPT = ['lib/provision-demo.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
const creators = files.filter((f) => {
  const src = readFileSync(f, 'utf8');
  return /prisma\.account\.create(Many)?\(|db\.account\.create(Many)?\(/.test(src);
});

console.log(`계정을 만드는 파일 ${creators.length}곳 발견`);

for (const f of creators) {
  const rel = f.replace(/\\/g, '/');
  if (EXEMPT.includes(rel)) {
    console.log(`  (제외) ${rel} — 시드 프로비저닝`);
    continue;
  }
  const src = readFileSync(f, 'utf8');
  check(
    src.includes('serviceId'),
    `${rel} — 계정을 만들면서 serviceId를 넣지 않는다(집계에서 누락된다)`,
  );
  check(
    src.includes('rawName'),
    `${rel} — 수집 원문(rawName)을 남기지 않는다`,
  );
}

// 최소 세 경로(확장 가져오기·메일 스캔·직접 입력)는 반드시 있어야 한다.
// 이 수가 줄었다면 경로가 사라진 게 아니라 탐지 정규식이 낡았을 가능성이 크다.
check(creators.length >= 4, '계정 생성 지점이 4곳 이상 탐지됨(정규식이 낡지 않았다)');

console.log(`verify-service-wiring: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
