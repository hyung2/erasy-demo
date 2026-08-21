// 로그인 뒤 화면을 찍는다.
//
// 실행: (다른 창에서 next start 띄운 뒤)
//   pnpm exec tsx scripts/shoot-authed.ts <baseUrl> <email> <password> <경로...>
//   예: ... http://localhost:3022 a@b.c pw /settings /dashboard
//
// 경로에 `::선택자`를 붙이면 그 요소를 누른 뒤에 찍는다 — 모달처럼 클릭해야 나오는 화면용.
//   예: /settings::.btn-danger
//
// 왜 만들었나: 이 제품의 화면은 거의 전부 로그인 뒤에 있는데, 그동안 시각 검증은 랜딩과
// 약관에서 멈춰 있었다. agent-browser는 이 환경에서 두 세션 연속 300초를 넘겨 못 쓰고,
// `chrome --screenshot`은 쿠키를 넣을 방법이 없어 로그인 화면만 찍힌다. 그래서 CDP로
// 세션 쿠키를 심고 찍는다 — 의존성을 하나도 늘리지 않는다(Node 22 내장 WebSocket).
//
// 로그인은 화면 조작이 아니라 Auth.js credentials 엔드포인트로 한다. 폼을 클릭해서 들어가면
// 로그인 UI가 바뀔 때마다 이 도구가 같이 깨진다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9223;
const VIEWPORT = { width: 1440, height: 960 };

const [baseUrl, email, password, ...paths] = process.argv.slice(2);
if (!baseUrl || !email || !password || paths.length === 0) {
  console.error('사용법: shoot-authed.ts <baseUrl> <email> <password> <경로...>');
  process.exit(1);
}
const outDir = process.env.SHOT_DIR ?? join(tmpdir(), 'erasy-shots');

// ── 1. 세션 쿠키 받아오기 ──
const jar = new Map<string, string>();
function absorb(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function login(): Promise<{ name: string; value: string }> {
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  absorb(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${baseUrl}/dashboard` }),
  });
  absorb(res);

  const entry = [...jar].find(([k]) => k.includes('session-token'));
  if (!entry) throw new Error(`로그인 실패(세션 쿠키 없음, status ${res.status})`);
  return { name: entry[0], value: entry[1] };
}

// ── 2. CDP ──
let nextId = 1;
type Cdp = {
  send: (method: string, params?: unknown, sessionId?: string) => Promise<Record<string, unknown>>;
  once: (method: string) => Promise<void>;
  close: () => void;
};

async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((ok, no) => {
    ws.addEventListener('open', () => ok(), { once: true });
    ws.addEventListener('error', () => no(new Error('CDP 연결 실패')), { once: true });
  });

  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  const waiters = new Map<string, (() => void)[]>();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      method?: string;
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (msg.id != null) {
      pending.get(msg.id)?.(msg.error ? { __error: msg.error.message } : (msg.result ?? {}));
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const fn of waiters.get(msg.method) ?? []) fn();
      waiters.delete(msg.method);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    once(method) {
      return new Promise((resolve) => {
        waiters.set(method, [...(waiters.get(method) ?? []), resolve]);
      });
    },
    close: () => ws.close(),
  };
}

/** Chrome이 디버깅 포트를 열 때까지. 고정 sleep은 느린 날 조용히 실패한다. */
async function waitForChrome(): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const v = (await res.json()) as { webSocketDebuggerUrl: string };
      if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl;
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Chrome 디버깅 포트가 열리지 않았습니다.');
}

async function main() {
  const cookie = await login();
  console.log(`로그인 성공: ${email}`);
  mkdirSync(outDir, { recursive: true });

  const profile = join(tmpdir(), `erasy-cdp-${Date.now()}`);
  const chrome: ChildProcess = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const wsUrl = await waitForChrome();
    console.log('  chrome 준비');
    const browser = await connect(wsUrl);
    console.log('  CDP 연결');
    const { targetId } = (await browser.send('Target.createTarget', {
      url: 'about:blank',
    })) as { targetId: string };
    const { sessionId } = (await browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })) as { sessionId: string };

    console.log(`  target ${targetId} / session ${sessionId}`);
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Network.enable', {}, sessionId);
    // 세션 쿠키를 심는다. httpOnly라 문서 스크립트로는 못 넣는다 — CDP를 쓰는 이유가 이것이다.
    await browser.send(
      'Network.setCookie',
      {
        name: cookie.name,
        value: cookie.value,
        url: baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
      },
      sessionId,
    );

    for (const spec of paths) {
      const [path, clickSelector] = spec.split('::');
      const loaded = browser.once('Page.loadEventFired');
      await browser.send('Page.navigate', { url: `${baseUrl}${path}` }, sessionId);
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
      // 이 화면들은 붙자마자 fetch로 숫자를 채운다. 로드 직후에 찍으면 늘 빈 상태만 남는다.
      await new Promise((r) => setTimeout(r, 2500));

      if (clickSelector) {
        const clicked = (await browser.send(
          'Runtime.evaluate',
          {
            expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)}); if (!el) return false; el.click(); return true; })()`,
            returnByValue: true,
          },
          sessionId,
        )) as { result?: { value?: boolean } };
        // 못 찾았으면 조용히 원래 화면을 찍고 끝나선 안 된다 — 그 그림은 "모달을 확인했다"로 읽힌다.
        if (clicked.result?.value !== true) {
          throw new Error(`선택자를 찾지 못했습니다: ${clickSelector} (${path})`);
        }
        await new Promise((r) => setTimeout(r, 600));
      }

      const shot = (await browser.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true },
        sessionId,
      )) as { data?: string; __error?: string };
      if (!shot.data) throw new Error(`촬영 실패 ${path}: ${shot.__error ?? '알 수 없음'}`);

      const file = join(outDir, `${spec.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'root'}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`  ${spec} → ${file}`);
    }

    browser.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
