// 정기 유출 대조의 주기 — 화면·크론·게이트가 같은 곳을 본다.
//
// 왜 파일을 따로 두는가: 대시보드가 "다음 점검 7일 후 · 유출 DB·이상 접속 자동 점검"이라고
// 적고 있었는데 둘 다 사실이 아니었다. 크론은 하루 한 번 돌고, 하는 일은 유출 대조뿐이다
// (이상 접속 자동 점검은 하지 않는다 — 완성도 WBS의 명시적 배제 항목이다). 화면이 자기
// 상수를 따로 갖고 있으면 실제 주기가 바뀌어도 그대로 남는다. 그래서 한 곳만 둔다.
//
// **서버 코드를 import하지 않는다.** 클라이언트 컴포넌트가 이 파일을 읽으므로 prisma 같은
// 것을 들이면 번들이 깨진다. 여기 있는 것은 값과 그 값에서 나온 표기뿐이다.
//
// 한쪽만 바뀌면 `scripts/verify-rescan-schedule.ts`가 깨진다.

/** Vercel 크론 표현식(UTC). vercel.json의 값과 일치해야 한다. */
export const RESCAN_CRON = '0 20 * * *';

const [, hourField] = RESCAN_CRON.split(' ');

/** 크론이 도는 시각(UTC 기준 시). */
export const RESCAN_UTC_HOUR = Number(hourField);

/** 같은 시각의 한국 시간. 화면 표기는 사용자가 사는 시간대로 적는다. */
export const RESCAN_KST_HOUR = (RESCAN_UTC_HOUR + 9) % 24;

/**
 * 같은 사용자를 다시 보기까지의 최소 간격.
 *
 * 20시간인 이유: 하루 한 번 도는 크론이 매번 실제로 일하도록 하루보다 짧게 두되,
 * 하루에 두 번 조회되지는 않게 한다. 24시간으로 두면 크론이 몇 분만 일찍 돌아도
 * 그날치가 통째로 건너뛰어진다.
 */
export const MIN_INTERVAL_HOURS = 20;

/** 시각 표기 — 크론이 바뀌면 화면 문구도 따라 바뀐다. */
export function rescanTimeLabel(hour: number = RESCAN_KST_HOUR): string {
  if (hour < 6) return `새벽 ${hour}시`;
  if (hour < 12) return `오전 ${hour}시`;
  if (hour === 12) return '정오';
  if (hour < 18) return `오후 ${hour - 12}시`;
  return `밤 ${hour - 12}시`;
}

/** 주기 표기. 크론이 하루 한 번 도는 형태임을 가드가 검증한다. */
export const RESCAN_PERIOD_LABEL = '하루 한 번';

/** 크론이 실제로 하는 일. 하지 않는 일은 적지 않는다. */
export const RESCAN_SCOPE_LABEL = '유출 DB 대조';
