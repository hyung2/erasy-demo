// API가 없는 데이터를 지어내지 않는지 확인한다.
//
// 실행: pnpm exec tsx scripts/verify-no-synthetic-api.ts
//
// 왜 이 가드가 필요한가
//   이 프로젝트에서 같은 실패가 세 번 반복됐다.
//     08-18 `/api/guard` 스텁 — 남의 유출 이력("Quora 2018-12")을 자기 것으로 표시
//     08-18 `/scanning` 연출 — 조회를 하지 않고 "확인된 계정 24개"라고 표기
//     08-21 `/access` 합성 — 로그 0건이면 "서울, KR / Chrome / Windows"를 생성
//
//   셋 다 시드가 깔려 있는 동안에는 아무 문제가 없어 보였다. 빈 상태로 바꾸는 순간
//   드러났다("시드는 가짜를 가려 주는 담요"). 그리고 셋 다 **런타임 오류를 내지 않는다** —
//   화면은 그럴듯하고 응답은 200이다. 사람이 눈으로 찾는 수밖에 없었다.
//
//   그래서 알려진 합성 값들을 목록으로 고정해 둔다. 새 API가 같은 값을 쓰면 여기서 걸린다.
//   목록에 없는 새로운 합성은 여전히 못 잡지만, **적어도 같은 실수는 반복되지 않는다.**
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

/**
 * API 응답에 나타나서는 안 되는 값들.
 * 시드 정본(lib/dummy-data.ts)과 프로비저닝은 이 규칙의 대상이 아니다 —
 * 거기서 시드를 정의하는 것은 정상이고, 문제는 **API가 그걸 실데이터인 척 돌려주는 것**이다.
 */
const SYNTHETIC_MARKERS = [
  '서울, KR', // 접속기록 합성 위치
  'Chrome / Windows', // 접속기록 합성 기기
  '_stub', // guard 스텁이 달던 표시
  '실시간 감시 중', // 상시 대조 파이프라인이 없는데 있다고 말하던 문구
  '마지막 대조 2시간 전',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const apiFiles = walk('app/api');
console.log(`API 라우트 ${apiFiles.length}개 검사`);

for (const f of apiFiles) {
  const rel = f.replace(/\\/g, '/');
  const src = readFileSync(f, 'utf8');
  for (const marker of SYNTHETIC_MARKERS) {
    // 주석에 적힌 것은 허용한다 — 무엇을 걷어냈는지 기록해 두는 것이 오히려 필요하다.
    const hits = src
      .split('\n')
      .filter((line) => line.includes(marker) && !line.trim().startsWith('//'));
    if (hits.length > 0) {
      failed += 1;
      console.error(`  FAIL ${rel} — 합성 값 "${marker}"이 코드에 있습니다`);
    } else {
      passed += 1;
    }
  }
}

// 시드 상수를 API가 직접 끌어다 쓰는지. 폴백으로 들어가면 남의 데이터가 자기 것으로 보인다.
// dummy-data를 참조하는 라우트는 있을 수 있으나(계정 목록의 명시적 시드 표기 등),
// 늘어나면 알아차려야 하므로 수를 고정해 둔다.
const seedImporters = apiFiles.filter((f) =>
  /from '@\/lib\/dummy-data'|from '\.\.\/.*dummy-data'/.test(readFileSync(f, 'utf8')),
);
const SEED_IMPORT_BUDGET = 2;
if (seedImporters.length > SEED_IMPORT_BUDGET) {
  failed += 1;
  console.error(
    `  FAIL 시드 상수를 참조하는 API가 ${seedImporters.length}개입니다(허용 ${SEED_IMPORT_BUDGET}):`,
  );
  for (const f of seedImporters) console.error(`      ${f.replace(/\\/g, '/')}`);
} else {
  passed += 1;
  console.log(`시드 상수 참조 API ${seedImporters.length}개 (허용 ${SEED_IMPORT_BUDGET})`);
}

console.log(`verify-no-synthetic-api: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
