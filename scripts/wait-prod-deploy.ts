// 배포가 실제로 갈아탈 때까지 기다린다 — 새 빌드가 뜨면 종료한다.
//
// 실행: pnpm exec tsx scripts/wait-prod-deploy.ts [https://...]
//
// **push 하기 전에 띄워 둔다.** 지금 지문을 먼저 잡고 그것이 바뀔 때까지 기다리는 구조라,
// push 뒤에 시작하면 이미 새 빌드를 기준으로 잡아 영원히 안 바뀐다.
//
// 로컬 빌드 산출물과 prod를 대조하는 방법은 쓰지 않는다 — Windows 로컬과 Linux Vercel은
// 같은 소스에서도 청크 해시가 갈린다(2026-08-25 실측: 9개 중 1개만 일치).
//
// 왜: push 직후에 헬스 체크를 돌리면 **이전 빌드**를 재고 "정상"이라고 말한다. 배포는
// 몇 분 걸리므로 그 사이에 잰 결과는 이번 변경과 아무 상관이 없다.
//
// 갈아탄 것을 어떻게 아는가: Next는 빌드마다 정적 청크 파일명에 새 해시를 넣는다.
// 지금 청크 목록을 지문으로 잡아 두고, 그 지문이 달라질 때까지 본다. 상태 코드는 보지
// 않는다 — 프리렌더 경로는 CDN이 서빙하므로 함수가 다 죽어도 200이 온다.
//
// 첫 판은 `_next/static/([^/"]+)/`로 잡았다가 경로 첫 마디인 "chunks"를 물었다. 값이
// 빌드마다 같으니 영원히 안 바뀌고, 8분을 기다린 뒤 "안 바뀌었다"고 보고했다. 지문은
// **바뀌는 것**을 잡아야 한다 — 안 바뀌는 것을 잡으면 실패가 아니라 침묵으로 나타난다.
export {};

const BASE = (process.argv[2] ?? 'https://service-app-seven-virid.vercel.app').replace(/\/$/, '');
const TIMEOUT_MS = 8 * 60_000;
const INTERVAL_MS = 15_000;

async function buildId(): Promise<string | null> {
  try {
    const html = await (await fetch(`${BASE}/`, { cache: 'no-store' })).text();
    // 청크 **파일명**을 모은다. 경로 마디가 아니라 해시가 든 이름이라 빌드마다 달라진다.
    const chunks = [...html.matchAll(/_next\/static\/chunks\/([^"'\s]+?\.js)/g)].map((m) => m[1]);
    if (chunks.length === 0) return null;
    return [...new Set(chunks)].sort().join('|').slice(0, 200);
  } catch {
    return null; // 배포 교체 중 일시적 실패는 정상 흐름으로 흡수한다
  }
}

async function main(): Promise<void> {
  const before = await buildId();
  if (!before) {
    console.log('빌드 ID를 찾지 못했다 — 기다리지 않고 넘어간다(수동 확인 필요)');
    return;
  }
  console.log(`이전 빌드 ${before}`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    const now = await buildId();
    if (now && now !== before) {
      console.log(`새 빌드 ${now} — 교체 완료`);
      return;
    }
  }
  console.log('제한 시간 안에 바뀌지 않았다 — Vercel 대시보드를 확인하십시오');
  process.exitCode = 1;
}

main();
