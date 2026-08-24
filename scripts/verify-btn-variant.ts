// 버튼 variant 누락 검사 — 소스 스캐닝, 읽기 전용.
//
// 실행: pnpm exec tsx scripts/verify-btn-variant.ts
//
// 왜: `.btn`은 여백·글꼴만 정하고 색은 variant(.btn-primary 등)가 정한다. variant를 빼면
// <button>에 브라우저 기본 회색 상자가 그대로 남아, 제품에 없는 종류의 버튼이 화면에 나온다.
// 타입체크도 lint도 이걸 못 잡는다 — 문자열이라서. 실제로 온보딩 화면에서 세 곳이 이 상태로
// 나가 있었고(2026-08-24 실촬영), 회색 버튼 두 개가 데모 첫 화면에 있었다.
//
// `.btn` 기본값에 색을 넣어 전역으로 막는 방법도 있지만, 그러면 테두리를 원치 않는
// .btn-ghost에 없던 선이 생긴다. 호출부에서 의도를 밝히게 하고 여기서 지킨다.
import { readFileSync, readdirSync } from 'node:fs';

/**
 * variant 목록은 CSS에서 읽는다.
 *
 * 손으로 적어 두면 새 variant를 만든 날 가드가 그 버튼을 결함으로 신고하고, 신고를 끄려고
 * 목록에 한 줄 더 적는 일이 반복된다. 그러면 목록이 진실을 따라다니는 꼬리가 된다.
 * 스타일시트가 무엇을 정의했는지가 답이니, 거기서 가져온다.
 */
function definedVariants(): string[] {
  const css = readFileSync('theme/erasy-dark.css', 'utf8');
  const found = new Set<string>();
  for (const m of css.matchAll(/^\.(btn-[a-z0-9-]+)/gm)) found.add(m[1]);
  return [...found];
}

const VARIANTS = definedVariants();

let passed = 0;
let failed = 0;

/** className 값으로 쓰이는 문자열 리터럴을 모은다(정적 문자열과 삼항 분기 양쪽). */
function classLiterals(src: string): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = [];
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    // className="..." / className={'...'} / 삼항의 양쪽 가지 '...'
    if (!text.includes('className')) {
      // 삼항이 여러 줄에 걸치는 경우를 위해 className 줄이 아니어도 따옴표 리터럴은 본다.
      if (!/^\s*(\?|:)\s*['"]/.test(text)) return;
    }
    for (const m of text.matchAll(/['"]([^'"{}]*\bbtn\b[^'"{}]*)['"]/g)) {
      out.push({ value: m[1], line: i + 1 });
    }
  });
  return out;
}

function main() {
  const files = ['app', 'components'].flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx') && !f.includes('.bak'))
      .map((f) => `${root}/${f}`),
  );
  const offenders: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const { value, line } of classLiterals(src)) {
      const classes = value.split(/\s+/).filter(Boolean);
      if (!classes.includes('btn')) continue; // btn-sm 등 단독은 별개 체계
      if (classes.some((c) => VARIANTS.includes(c))) continue;
      offenders.push(`${file}:${line} → "${value}"`);
    }
  }

  console.log(`tsx ${files.length}개 검사 · CSS variant ${VARIANTS.length}종`);
  if (offenders.length > 0) {
    failed += 1;
    console.error('  FAIL variant 없는 .btn 사용:');
    for (const o of offenders) console.error(`    ${o}`);
  } else {
    passed += 1;
  }

  // 가드가 실제로 잡는지 스스로 확인한다. 늘 통과하는 검사는 검사가 아니다.
  const sample = classLiterals(`<button className="btn" />`);
  const catchesBare = sample.length === 1 && !sample[0].value.split(/\s+/).some((c) => VARIANTS.includes(c));
  if (catchesBare) passed += 1;
  else {
    failed += 1;
    console.error('  FAIL 가드가 맨 btn을 잡지 못한다(검사 자체가 고장)');
  }

  console.log(`verify-btn-variant: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
