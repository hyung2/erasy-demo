// 자동 점검 주기가 한 곳에서만 정해지는지 — 소스 스캔, 자원 불필요.
//
// 실행: pnpm exec tsx scripts/verify-rescan-schedule.ts
//
// 왜: 대시보드가 "다음 점검 7일 후 · 유출 DB·이상 접속 자동 점검"이라고 적고 있었다. 크론은
// 하루 한 번 돌고 하는 일은 유출 대조뿐이므로 둘 다 사실이 아니었다. 화면이 자기 상수를
// 따로 갖고 있으면 실제 주기가 바뀌어도 그 자리는 그대로 남는다 — 고쳐도 또 어긋난다.
//
// 그래서 주기 정본(lib/rescan-schedule.ts) 하나를 두고, 크론 설정·게이트·화면이 모두
// 그것을 보게 했다. 이 가드는 셋 중 하나만 바뀌면 깨진다.
//
// 방침의 k값과 lib/service-aggregate.ts의 k를 묶어 둔 선례와 같은 방식이다.
import { readFileSync } from 'node:fs';
import {
  RESCAN_CRON,
  RESCAN_KST_HOUR,
  RESCAN_UTC_HOUR,
  MIN_INTERVAL_HOURS,
  RESCAN_PERIOD_LABEL,
  RESCAN_SCOPE_LABEL,
  rescanTimeLabel,
} from '../lib/rescan-schedule';

export {};

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

const DASH = 'app/(app)/dashboard/page.tsx';
const RESCAN = 'lib/breach-rescan.ts';

/**
 * 주석을 걷어낸 소스. 이 가드는 **화면에 그려지는 것**을 검사하므로 설명 문장은 보면 안 된다.
 *
 * 걷어내지 않으면 결함을 고친 사람이 "예전에는 7일 후라고 적혀 있었다"고 기록하는 순간
 * 검사가 깨진다 — 고친 것을 벌하는 검사가 되고, 그러면 다음 사람은 기록을 지운다.
 *
 * 줄 안쪽의 `//`는 건드리지 않는다(URL이 그렇게 생겼다). 블록 주석과 JSX 주석,
 * 그리고 줄 첫머리의 한 줄 주석만 지운다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function main(): void {
  // ── 크론 설정과 정본이 같은 값을 말한다 ──
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    crons?: { path: string; schedule: string }[];
  };
  const cron = (vercel.crons ?? []).find((c) => c.path.includes('breach-rescan'));
  check(cron !== undefined, '1 vercel.json에 유출 재대조 크론이 있다');
  check(
    cron?.schedule === RESCAN_CRON,
    `2 크론 표현식이 주기 정본과 같다 (vercel.json ${cron?.schedule} vs 정본 ${RESCAN_CRON})`,
  );

  // ── 그 표현식이 정말 "하루 한 번"이다 ──
  //   표기만 고치고 크론을 여러 번 돌게 바꾸면 화면이 다시 거짓말을 한다.
  const [min, hour, dom, mon, dow] = RESCAN_CRON.split(' ');
  check(
    /^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*',
    `3 크론이 하루 한 번 도는 형태다 — "${RESCAN_PERIOD_LABEL}" 표기의 근거 (${RESCAN_CRON})`,
  );
  check(
    RESCAN_KST_HOUR === (RESCAN_UTC_HOUR + 9) % 24,
    `4 한국 시간 표기가 UTC에서 파생된다 (UTC ${RESCAN_UTC_HOUR}시 → ${rescanTimeLabel()})`,
  );

  // ── 비용 게이트가 크론 주기와 정합한다 ──
  //   24시간 이상이면 크론이 몇 분 일찍 돌 때 그날치가 통째로 건너뛰어지고,
  //   12시간 미만이면 하루에 두 번 조회된다. 둘 다 주기 표기를 거짓으로 만든다.
  check(
    MIN_INTERVAL_HOURS < 24 && MIN_INTERVAL_HOURS >= 12,
    `5 재조회 간격이 하루 한 번과 맞는다 (${MIN_INTERVAL_HOURS}시간)`,
  );

  // ── 간격 상수가 두 벌로 갈라져 있지 않다 ──
  const rescanSrc = stripComments(readFileSync(RESCAN, 'utf8'));
  check(
    /from '\.\/rescan-schedule'/.test(rescanSrc),
    '6 breach-rescan이 간격을 정본에서 가져온다',
  );
  check(
    !/^\s*export const MIN_INTERVAL_HOURS\s*=\s*\d/m.test(rescanSrc),
    '7 breach-rescan이 간격을 스스로 다시 정하지 않는다',
  );

  // ── 화면이 자기 상수를 갖지 않는다 ──
  const dash = stripComments(readFileSync(DASH, 'utf8'));
  check(
    /from '@\/lib\/rescan-schedule'/.test(dash),
    '8 대시보드가 주기 정본을 import한다',
  );
  check(
    !/\d+일 후/.test(dash),
    '9 화면에 "N일 후" 같은 고정 주기가 없다 — 크론이 바뀌어도 그 자리는 안 바뀐다',
  );

  // ── 하지 않는 일을 말하지 않는다 ──
  //   지속 관리 구획만 본다. 4축 카드의 "이상 접속"은 관측된 접속 기록을 재는 축이라
  //   정당한 표기이고, 여기서 문제 삼는 것은 "자동으로 봐 준다"는 약속이다.
  const guardSection = dash.match(/aria-label="지속 관리"[\s\S]*?<\/section>/)?.[0] ?? '';
  check(guardSection.length > 0, '10 지속 관리 구획을 찾는다');
  check(
    !/이상 접속/.test(guardSection),
    '11 지속 관리가 이상 접속 자동 점검을 약속하지 않는다 — 하지 않는 일이다',
  );
  check(
    guardSection.includes('RESCAN_SCOPE_LABEL') || guardSection.includes(RESCAN_SCOPE_LABEL),
    `12 지속 관리가 실제로 하는 일만 적는다 (${RESCAN_SCOPE_LABEL})`,
  );

  console.log(`verify-rescan-schedule: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
