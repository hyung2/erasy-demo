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

// ATTACH_PORT를 주면 이미 떠 있는 브라우저에 붙는다(watch-csp.ts가 띄운 창 등).
// 사람이 구글로 로그인한 세션을 그대로 쓰기 위한 통로다 — 헤드리스로는 구글 로그인을
// 통과할 수 없어서, 실계정 화면은 이 경로로만 볼 수 있다.
//
// 붙기 모드에서는 **클릭하지 않는다.** 사람의 실계정이 로그인된 브라우저이므로
// 여기서 하는 일은 새 탭을 열어 찍고 닫는 것뿐이다.
const ATTACH_PORT = process.env.ATTACH_PORT ? Number(process.env.ATTACH_PORT) : null;

const [baseUrl, ...rest] = process.argv.slice(2);
const [email, password] = ATTACH_PORT ? [null, null] : rest;
const paths = ATTACH_PORT ? rest : rest.slice(2);

if (!baseUrl || paths.length === 0 || (!ATTACH_PORT && (!email || !password))) {
  console.error('사용법: shoot-authed.ts <baseUrl> <email> <password> <경로...>');
  console.error('        ATTACH_PORT=9224 shoot-authed.ts <baseUrl> <경로...>');
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
  if (!email || !password) throw new Error('로그인 정보가 없습니다.');
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
  /** 이벤트를 계속 받는다. once는 한 번 기다리고 끝나서 누적 관측에 못 쓴다. */
  on: (method: string, handler: (params: Record<string, unknown>) => void) => void;
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
  const listeners = new Map<string, ((p: Record<string, unknown>) => void)[]>();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (msg.id != null) {
      pending.get(msg.id)?.(msg.error ? { __error: msg.error.message } : (msg.result ?? {}));
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const fn of waiters.get(msg.method) ?? []) fn();
      waiters.delete(msg.method);
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params ?? {});
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
    on(method, handler) {
      listeners.set(method, [...(listeners.get(method) ?? []), handler]);
    },
    close: () => ws.close(),
  };
}

/** Chrome이 디버깅 포트를 열 때까지. 고정 sleep은 느린 날 조용히 실패한다. */
async function waitForChrome(): Promise<string> {
  const port = ATTACH_PORT ?? PORT;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
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
  const cookie = ATTACH_PORT ? null : await login();
  if (cookie) console.log(`로그인 성공: ${email}`);
  else console.log(`기존 브라우저에 붙습니다 (포트 ${ATTACH_PORT}) — 클릭하지 않습니다.`);
  mkdirSync(outDir, { recursive: true });

  const profile = join(tmpdir(), `erasy-cdp-${Date.now()}`);
  const chrome: ChildProcess | null = ATTACH_PORT
    ? null
    : spawn(
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

    // CSP 위반을 브라우저에서 직접 받는다.
    //
    // 서버의 report-uri 로그로 확인하려면 스트림을 먼저 켜고 그 다음 화면을 밟아야 하는데,
    // 그 순서가 어긋나면 "위반 0건"과 "관측을 놓쳤다"가 같은 빈 결과로 보인다. 브라우저가
    // 띄우는 경고를 직접 받으면 그 구분이 필요 없다. Report-Only 위반도 여기 찍힌다.
    const cspViolations: string[] = [];
    await browser.send('Log.enable', {}, sessionId);
    browser.on('Log.entryAdded', (p) => {
      const entry = p.entry as { text?: string; source?: string } | undefined;
      const text = entry?.text ?? '';
      if (/Content Security Policy/i.test(text)) cspViolations.push(text.replace(/\s+/g, ' ').slice(0, 200));
    });
    // 세션 쿠키를 심는다. httpOnly라 문서 스크립트로는 못 넣는다 — CDP를 쓰는 이유가 이것이다.
    // 붙기 모드에서는 심지 않는다 — 그 브라우저에 이미 사람의 세션이 있고, 우리가 그 값을
    // 알 필요도 없다.
    if (cookie) {
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
    }

    for (const spec of paths) {
      const [path, clickSelector] = spec.split('::');
      const loaded = browser.once('Page.loadEventFired');
      await browser.send('Page.navigate', { url: `${baseUrl}${path}` }, sessionId);
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
      // 이 화면들은 붙자마자 fetch로 숫자를 채운다. 로드 직후에 찍으면 늘 빈 상태만 남는다.
      //
      // 기본 2.5초는 264계정 실계정에서 모자랐다 — /api/score가 2.5초 걸려 경계에 걸렸고,
      // "불러오는 중"이 그대로 찍혀 데이터가 없는 화면처럼 보였다(2026-08-24). 넉넉히 두고,
      // 느린 화면에서는 SHOT_WAIT로 더 늘린다.
      await new Promise((r) => setTimeout(r, Number(process.env.SHOT_WAIT ?? 6000)));

      if (clickSelector && ATTACH_PORT) {
        throw new Error('붙기 모드에서는 클릭하지 않습니다.');
      }
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

      // SHOT_PROBE에 선택자를 주면 박스와 여백을 재서 찍는다. 스크린샷만으로는 "빈 공간이
      // 넓다"까지만 알 수 있고, 어느 규칙이 그 공간을 만들었는지는 재야 나온다.
      if (process.env.SHOT_PROBE) {
        const probe = (await browser.send(
          'Runtime.evaluate',
          {
            expression: `JSON.stringify(${JSON.stringify(process.env.SHOT_PROBE.split(',').map((x) => x.trim()))}.map((sel) => {
              const el = document.querySelector(sel);
              if (!el) return { sel, missing: true };
              const r = el.getBoundingClientRect();
              const c = getComputedStyle(el);
              return { sel, h: Math.round(r.height), pt: c.paddingTop, pb: c.paddingBottom,
                       mt: c.marginTop, mb: c.marginBottom, display: c.display, minH: c.minHeight };
            }), null, 1)`,
            returnByValue: true,
          },
          sessionId,
        )) as { result?: { value?: string } };
        console.log(probe.result?.value ?? '(측정 실패)');
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

    if (cspViolations.length === 0) {
      console.log('CSP 위반 0건 — 밟은 경로 기준');
    } else {
      // 중복을 접어 둔다. 같은 위반이 화면마다 반복되면 개수만 커지고 종류가 안 보인다.
      const uniq = [...new Set(cspViolations)];
      console.log(`CSP 위반 ${cspViolations.length}건 (종류 ${uniq.length})`);
      for (const v of uniq) console.log(`  - ${v}`);
    }

    // 붙기 모드에서는 우리가 연 탭만 닫는다. 사람이 보고 있는 탭은 건드리지 않는다.
    if (ATTACH_PORT) await browser.send('Target.closeTarget', { targetId });
    browser.close();
  } finally {
    chrome?.kill();
  }
}

main().catch((e) => {
  console.error('실패:', (e as Error).message);
  process.exitCode = 1;
});
