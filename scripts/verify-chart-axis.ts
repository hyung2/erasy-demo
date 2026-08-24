// 추이 차트 x축 라벨 검증 — 순수 함수, DB 불필요.
//
// 실행: pnpm exec tsx scripts/verify-chart-axis.ts
//
// 왜: 이 차트의 x는 날짜가 아니라 측정 회차다. 하루에 여러 번 재면 같은 날짜가 그 횟수만큼
// 찍히고, 실계정에서 `08-20`이 네 번 연속 나왔다(2026-08-24 실측). 축이 같은 말을 반복하면
// 데이터가 맞아도 읽는 사람은 고장으로 읽는다.
//
// 접는 규칙이 틀리면 라벨이 가리키는 지점이 어긋나므로, 어느 자리에 남는지까지 잰다.
import { collapseRepeatedLabels } from '../components/ScoreBenchmarkChart';

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
const eq = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

function main() {
  // 실계정에서 실제로 나온 모양
  const real = ['08-20', '08-20', '08-20', '08-20', '08-21', '08-24'];
  const collapsedReal = collapseRepeatedLabels(real);
  check(
    eq(collapsedReal, ['', '', '', '08-20', '08-21', '08-24']),
    `1 반복은 그룹 끝에만 남는다 (${JSON.stringify(collapsedReal)})`,
  );

  check(
    eq(collapseRepeatedLabels(['a', 'b', 'c']), ['a', 'b', 'c']),
    '2 중복이 없으면 그대로 둔다',
  );
  check(
    eq(collapseRepeatedLabels(['a', 'a']), ['', 'a']),
    '3 두 개가 같으면 뒤에 남는다',
  );
  check(
    eq(collapseRepeatedLabels(['a', 'a', 'a']), ['', '', 'a']),
    '4 셋이 같아도 하나만 남는다',
  );
  // 마지막 라벨은 언제나 남아야 한다 — 최신 시점이 축에서 사라지면 안 된다.
  const tail = collapseRepeatedLabels(['x', 'y', 'y']);
  check(tail[tail.length - 1] === 'y', '5 마지막 지점은 항상 라벨을 갖는다');

  // 같은 날짜가 떨어져 있으면 각각 남는다(연속일 때만 접는다).
  check(
    eq(collapseRepeatedLabels(['a', 'b', 'a']), ['a', 'b', 'a']),
    '6 떨어져 있는 같은 라벨은 접지 않는다',
  );

  // 길이는 항상 보존된다 — 라벨 자리와 데이터 점의 인덱스가 어긋나면 안 된다.
  for (const input of [real, ['a'], [], ['a', 'a', 'b', 'b']]) {
    if (collapseRepeatedLabels(input).length !== input.length) {
      failed += 1;
      console.error(`  FAIL 7 길이 보존 실패: ${JSON.stringify(input)}`);
      break;
    }
  }
  check(true, '7 라벨 개수가 보존된다(점 인덱스와 어긋나지 않는다)');

  check(eq(collapseRepeatedLabels([]), []), '8 빈 입력도 다루다');

  console.log(`verify-chart-axis: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
