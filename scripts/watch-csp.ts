// CSP 관측용 브라우저 창을 띄우고, 그 안에서 일어나는 위반을 계속 받아 적는다.
//
// 실행: pnpm exec tsx scripts/watch-csp.ts [https://...] [분]
//
// 왜 이게 따로 필요한가: 헤드리스로는 구글 로그인을 통과할 수 없어서, 이 제품에서 가장
// 위험한 구간인 **OAuth 왕복**의 CSP 위반이 한 번도 관측되지 않았다. 그 구간에서 정책이
// 무언가를 막는지 모른 채 enforce로 올리면 무대에서 로그인이 깨진다.
//
// 사람이 로그인하는 동안 옆에서 듣고 있어야 한다. 로그인이 끝난 뒤에 붙으면 이미 지나간
// 콘솔 경고는 받지 못한다 — "위반 0건"과 "관측을 놓쳤다"가 같은 빈 결과가 된다.
//
// 이 창에서 하는 일은 **듣기와 찍기뿐이다.** 사람의 실계정이 로그인된 브라우저이므로
// 이 스크립트는 클릭도 입력도 하지 않는다.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CSP_PORT ?? 9224);
const BASE = process.argv[2] ?? 'https://service-app-seven-virid.vercel.app';
const MINUTES = Number(process.argv[3] ?? 20);
const OUT = process.env.CSP_LOG ?? join(tmpdir(), 'erasy-csp-watch.log');

// 프로필을 고정한다. 매번 새로 만들면 로그인을 매번 다시 해야 한다.
const PROFILE = process.env.CSP_PROFILE ?? join(tmpdir(), 'erasy-csp-profile');

// 확장을 함께 올린다.
//
// 확장은 제품의 일부다. 없이 띄우면 "연결목록 한 번에 가져오기"가 조건부로 사라지고,
// 화면을 보는 사람은 버튼이 없는 것을 결함으로 읽는다(2026-08-24에 실제로 그랬다).
// 관측용 창은 사용자가 실제로 쓰는 환경과 같아야 한다.
const EXTENSION = resolve(process.env.ERASY_EXTENSION ?? 'extension');

function log(line: string): void {
  console.log(line);
  appendFileSync(OUT, `${line}\n`);
}

async function waitForChrome(): Promise<string> {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const v = (await res.json()) as { webSocketDebuggerUrl: string };
      if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Chrome 디버깅 포트가 열리지 않았습니다.');
}

async function main() {
  writeFileSync(OUT, '');
  log(`관측 시작 · ${BASE} · ${MINUTES}분 · 포트 ${PORT}`);

  const hasExt = existsSync(join(EXTENSION, 'manifest.json'));
  log(hasExt ? `확장 로드: ${EXTENSION}` : `확장 없음(${EXTENSION}) — 원터치 경로는 보이지 않습니다`);

  spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      // --load-extension은 Chrome 137에서 제거됐다(151에서 무시됨을 실측). 대신 CDP의
      // Extensions.loadUnpacked로 올린다 — 그 명령은 이 플래그를 요구한다.
      ...(hasExt ? ['--enable-unsafe-extension-debugging'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,960',
      // 목적지를 여기서 열지 않는다. content script는 이미 떠 있는 페이지에 주입되지 않으므로
      // **확장을 올린 뒤에** 열어야 원터치 경로가 처음부터 보인다.
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  ).unref();

  const ws = new WebSocket(await waitForChrome());
  await new Promise<void>((ok, no) => {
    ws.addEventListener('open', () => ok(), { once: true });
    ws.addEventListener('error', () => no(new Error('CDP 연결 실패')), { once: true });
  });
  log('CDP 연결 — 이제 이 창에서 로그인하십시오.');

  let id = 1;
  const send = (method: string, params: unknown = {}, sessionId?: string) =>
    ws.send(JSON.stringify({ id: id++, method, params, sessionId }));

  const seen = new Set<string>();
  const attached = new Set<string>();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    };
    if (!msg.method) return;

    // 탭이 새로 생기면(OAuth 팝업 포함) 거기서도 듣는다. 로그인 왕복이 다른 탭에서
    // 일어나는 경우가 있고, 그 탭을 놓치면 정작 보려던 구간을 못 본다.
    if (msg.method === 'Target.attachedToTarget') {
      const sid = (msg.params?.sessionId as string) ?? '';
      const info = msg.params?.targetInfo as { url?: string; type?: string } | undefined;
      if (sid && !attached.has(sid)) {
        attached.add(sid);
        send('Log.enable', {}, sid);
        send('Runtime.enable', {}, sid);
        log(`  탭 관측 시작: ${info?.type ?? '?'} ${(info?.url ?? '').slice(0, 80)}`);
      }
      return;
    }

    const text =
      msg.method === 'Log.entryAdded'
        ? ((msg.params?.entry as { text?: string })?.text ?? '')
        : msg.method === 'Runtime.consoleAPICalled'
          ? ((msg.params?.args as { value?: string }[] | undefined) ?? [])
              .map((a) => String(a?.value ?? ''))
              .join(' ')
          : '';
    if (!/Content Security Policy/i.test(text)) return;

    const line = text.replace(/\s+/g, ' ').slice(0, 240);
    if (seen.has(line)) return;
    seen.add(line);
    log(`  [CSP] ${line}`);
  });

  // 자동으로 모든 탭에 붙는다 — 사람이 어디로 이동하든 따라간다.
  send('Target.setDiscoverTargets', { discover: true });
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  if (!hasExt) send('Target.createTarget', { url: BASE });

  if (hasExt) {
    const loadId = id++;
    ws.send(
      JSON.stringify({
        id: loadId,
        method: 'Extensions.loadUnpacked',
        params: { path: EXTENSION },
      }),
    );
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: { id?: string };
        error?: { message?: string };
      };
      if (m.id !== loadId) return;
      if (m.error) {
        log(`확장 로드 실패: ${m.error.message ?? '알 수 없음'}`);
        return;
      }
      log(`확장 로드 성공: id=${m.result?.id ?? '?'}`);
      send('Target.createTarget', { url: BASE });
      log(`${BASE} 열었습니다 — 확장이 먼저 올라갔으므로 원터치가 처음부터 보입니다.`);
    });
  }

  await new Promise((r) => setTimeout(r, MINUTES * 60_000));
  log(`관측 종료 — CSP 위반 ${seen.size}종`);
  if (seen.size === 0) log('밟은 경로에서 정책이 막은 것은 없습니다.');
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
