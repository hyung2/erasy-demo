// 확장 자동 감지 — background.js를 **실제로 실행해** 검사한다. 자원 불필요.
//
// 실행: pnpm exec tsx scripts/verify-ext-autodetect.ts
//
// 왜 소스 문자열 검사가 아니라 실행인가
//   여기서 깨진 것은 문구가 아니라 **동작**이었다. 화면에는 "설치했어요 · 다시 확인" 버튼이
//   멀쩡히 있었고 코드도 정상으로 읽혔지만, 크롬이 이미 열린 탭에 content script를 나중에
//   주입하지 않기 때문에 그 버튼은 원리상 성공할 수 없었다(2026-08-27 사용자 지적).
//   "코드가 있다"가 "동작한다"를 뜻하지 않는 자리라, 가드도 실행해서 답을 봐야 한다.
//
// 어떻게: chrome API를 가짜로 만들어 vm에서 background.js를 돌린다. 등록된 리스너를 붙잡아
//   설치 이벤트·탭 주소·메시지를 실제로 먹이고 반응을 읽는다. 브라우저도 계정도 필요 없다.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

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

type Listener = (...args: unknown[]) => unknown;

/** background.js를 가짜 chrome 위에서 돌리고, 붙잡은 리스너들을 돌려준다. */
function boot(openTabs: Array<{ id: number; url: string }>) {
  const installed: Listener[] = [];
  const updated: Listener[] = [];
  const messaged: Listener[] = [];
  const reloaded: number[] = [];
  let queriedWith: unknown = null;

  const focused: number[] = [];
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: (f: Listener) => installed.push(f) },
      onMessage: { addListener: (f: Listener) => messaged.push(f) },
    },
    tabs: {
      onUpdated: { addListener: (f: Listener) => updated.push(f) },
      query: (q: unknown, cb: (t: unknown[]) => void) => {
        queriedWith = q;
        cb(openTabs);
      },
      reload: (id: number) => reloaded.push(id),
      create: () => Promise.resolve({ id: 1 }),
      remove: () => Promise.resolve(),
      get: (id: number) => Promise.resolve({ id, url: '', windowId: 1 }),
      update: (id: number, opts: { active?: boolean }) => {
        if (opts?.active) focused.push(id);
        return Promise.resolve({ id });
      },
    },
    windows: { update: () => Promise.resolve({}) },
    scripting: { executeScript: () => Promise.resolve([{ result: 0 }]) },
  };

  const ctx = createContext({ chrome, console, setTimeout, Date, Object, Array, Set, JSON });
  runInContext(readFileSync('extension/background.js', 'utf8'), ctx, {
    filename: 'extension/background.js',
  });

  return {
    installed,
    updated,
    messaged,
    reloaded,
    focused,
    queried: () => queriedWith,
    /** 탭이 그 주소로 이동했다고 알린다. */
    visit(url: string) {
      for (const f of updated) f(1, { url }, { id: 1 });
    },
    /** 앱 탭(senderTabId)이 로그인 대기를 등록/해제한다. */
    watch(provider: string, on: boolean, senderTabId: number | null) {
      for (const f of messaged) {
        f(
          { type: 'erasy:loginWatch', provider, on },
          senderTabId == null ? {} : { tab: { id: senderTabId } },
          () => {},
        );
      }
    },
    /** 로그인 상태를 물어본다. */
    askLogin(provider: string): unknown {
      let answer: unknown = undefined;
      for (const f of messaged) {
        f({ type: 'erasy:loginState', provider }, {}, (r: unknown) => {
          answer = r;
        });
      }
      return answer;
    },
    ask(type: string): unknown {
      let answer: unknown = undefined;
      for (const f of messaged) {
        f({ type }, {}, (r: unknown) => {
          answer = r;
        });
      }
      return answer;
    },
  };
}

type LoginAnswer = { ok?: boolean; loggedIn?: boolean | null };

async function main(): Promise<void> {
  const bg = readFileSync('extension/background.js', 'utf8');
  const bridge = readFileSync('extension/bridge.js', 'utf8');
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8')) as {
    version: string;
    permissions: string[];
    content_scripts: Array<{ matches: string[] }>;
  };
  const conn = readFileSync('components/ConnectionImport.tsx', 'utf8');
  const onboard = readFileSync('app/scanning/page.tsx', 'utf8');

  // ── A. 설치 순간 앱 탭을 다시 읽는가 ──
  //   이게 없으면 설치해도 그 탭에는 브리지가 없다. 사용자에게는 "설치했는데 아무 일도
  //   안 일어나는" 화면이고, 그때 우리가 줄 수 있는 답은 "새로고침하세요"뿐이었다.
  {
    const app = boot([
      { id: 11, url: 'https://service-app-seven-virid.vercel.app/scanning' },
      { id: 12, url: 'http://localhost:3000/scanning' },
    ]);
    check(app.installed.length > 0, 'A1 설치 이벤트를 듣는다');
    for (const f of app.installed) f({ reason: 'install' });
    check(app.reloaded.length === 2, `A2 열려 있는 앱 탭을 모두 다시 읽는다 (${app.reloaded.length}/2)`);

    const q = app.queried() as { url?: string[] } | null;
    check(
      Array.isArray(q?.url) &&
        q.url.some((u) => u.includes('service-app-seven-virid.vercel.app')) &&
        q.url.some((u) => u.includes('localhost')),
      'A3 배포 주소와 로컬 주소를 모두 찾는다',
    );
    const csMatches = manifest.content_scripts?.[0]?.matches ?? [];
    // 빈 배열은 통과가 아니다 — 조회 자체를 안 해도 every()는 참이라 조용히 넘어간다.
    check(
      (q?.url ?? []).length > 0 && (q?.url ?? []).every((u) => csMatches.includes(u)),
      'A4 다시 읽는 대상이 브리지가 실제로 얹히는 주소와 같다 — 어긋나면 새로 읽어도 소용없다',
    );
  }

  // ── B. 자동 업데이트로는 화면을 날리지 않는가 ──
  {
    const app = boot([{ id: 21, url: 'https://service-app-seven-virid.vercel.app/scan' }]);
    for (const f of app.installed) f({ reason: 'update' });
    check(app.reloaded.length === 0, 'B1 크롬 자동 업데이트로는 사용자 화면을 새로 읽지 않는다');
  }

  // ── C. 다른 탭의 로그인을 알아채는가 ──
  {
    const app = boot([]);
    check(app.updated.length > 0, 'C1 탭 주소 변화를 듣는다');

    check(
      (app.askLogin('google') as LoginAnswer)?.loggedIn === null,
      'C2 처음에는 "모른다"(null)다 — 모르는 것을 로그아웃으로 읽으면 로그인한 사람에게 로그인을 시킨다',
    );

    app.visit('https://accounts.google.com/v3/signin/identifier?flowName=x');
    check((app.askLogin('google') as LoginAnswer)?.loggedIn === false, 'C3 구글 로그인 화면 → 로그아웃');
    app.visit('https://myaccount.google.com/connections');
    check((app.askLogin('google') as LoginAnswer)?.loggedIn === true, 'C4 구글 내 계정 → 로그인됨');

    app.visit('https://accounts.kakao.com/login?continue=https%3A%2F%2Fapps.kakao.com');
    check((app.askLogin('kakao') as LoginAnswer)?.loggedIn === false, 'C5 카카오 로그인 화면 → 로그아웃');
    app.visit('https://apps.kakao.com/connected/app/list?lang=ko&service_type=kakao');
    check((app.askLogin('kakao') as LoginAnswer)?.loggedIn === true, 'C6 카카오 연결목록 → 로그인됨');

    app.visit('https://nid.naver.com/nidlogin.login?mode=form');
    check((app.askLogin('naver') as LoginAnswer)?.loggedIn === false, 'C7 네이버 로그인 화면 → 로그아웃');
    app.visit('https://nid.naver.com/internalToken/view/tokenList/pc/ko');
    check((app.askLogin('naver') as LoginAnswer)?.loggedIn === true, 'C8 네이버 연결목록 → 로그인됨');

    // 3사 밖 주소는 아무것도 바꾸지 않는다. 이 제품이 파는 것이 "남의 흔적을 안 모은다"라,
    // 방문 기록을 쌓는 코드가 슬쩍 끼어드는지 여기서 본다.
    const before = ['google', 'kakao', 'naver'].map(
      (p) => (app.askLogin(p) as LoginAnswer)?.loggedIn,
    );
    app.visit('https://news.example.com/article/1');
    app.visit('https://mail.daum.net/');
    const after = ['google', 'kakao', 'naver'].map(
      (p) => (app.askLogin(p) as LoginAnswer)?.loggedIn,
    );
    check(
      JSON.stringify(before) === JSON.stringify(after),
      'C9 3사 밖 주소는 아무 값도 남기지 않는다',
    );

    check(
      (app.askLogin('unknown-provider') as LoginAnswer)?.loggedIn === null,
      'C10 모르는 제공사는 null로 답한다',
    );
    const providers = app.ask('erasy:providers') as { providers?: string[] };
    check((providers?.providers ?? []).length === 3, 'C11 기존 제공사 조회가 그대로 동작한다');
  }

  // ── G. 로그인이 감지되면 앱 탭으로 데려오는가 ──
  //   등록한 동안만·한 번만·자기 탭만. 셋 중 하나라도 무너지면 "탭을 마음대로 뺏는 확장"이 된다.
  {
    const app = boot([]);
    const flush = () => new Promise((r) => setTimeout(r, 0)); // maybeReturnToApp이 async라 한 틱 기다린다

    // 등록 전 로그인 — 아무 일도 안 일어나야 한다
    app.visit('https://apps.kakao.com/connected/app/list?lang=ko');
    await flush();
    check(app.focused.length === 0, 'G1 등록 전에는 로그인에 반응하지 않는다');

    // 등록 후 로그인 → 그 탭을 앞으로
    app.watch('kakao', true, 77);
    app.visit('https://apps.kakao.com/connected/app/list?lang=ko');
    await flush();
    check(app.focused.length === 1 && app.focused[0] === 77, `G2 등록한 탭(77)을 앞으로 가져온다 (${JSON.stringify(app.focused)})`);

    // 한 번만 — 같은 로그인이 또 보여도 다시 뺏지 않는다
    app.visit('https://apps.kakao.com/connected/app/list?lang=ko');
    await flush();
    check(app.focused.length === 1, 'G3 한 번 데려온 뒤에는 다시 반응하지 않는다');

    // 다른 제공사 로그인에는 반응하지 않는다
    app.watch('kakao', true, 77);
    app.visit('https://nid.naver.com/internalToken/view/tokenList/pc/ko');
    await flush();
    check(app.focused.length === 1, 'G4 기다리는 제공사가 아니면 움직이지 않는다');

    // 로그인 화면 진입(실패 방향)에는 반응하지 않는다
    app.visit('https://accounts.kakao.com/login?continue=x');
    await flush();
    check(app.focused.length === 1, 'G5 로그인 "화면"은 로그인 완료가 아니다');

    // 해제 후에는 반응하지 않는다
    app.watch('kakao', false, 77);
    app.visit('https://apps.kakao.com/connected/app/list?lang=ko');
    await flush();
    check(app.focused.length === 1, 'G6 해제하면 더는 데려오지 않는다');

    // 보낸 탭이 불명이면 등록 자체가 안 된다 — 남의 탭을 지목하는 통로가 되면 안 된다
    app.watch('kakao', true, null);
    app.visit('https://apps.kakao.com/connected/app/list?lang=ko');
    await flush();
    check(app.focused.length === 1, 'G7 보낸 탭을 모르면 등록하지 않는다');
  }

  // ── D. 앱과 확장 사이의 규약이 맞물리는가 ──
  {
    check(bridge.includes("'login-state'"), 'D1 브리지가 로그인 조회를 중계한다');
    check(bridge.includes("'erasy:loginState'"), 'D2 브리지가 백그라운드 규약 이름을 쓴다');
    check(bg.includes("'erasy:loginState'"), 'D3 백그라운드가 같은 이름으로 답한다');
    check(
      bridge.includes("'login-watch'") && bridge.includes("'erasy:loginWatch'") && bg.includes("'erasy:loginWatch'"),
      'D3b 로그인 대기 등록도 같은 규약으로 오간다',
    );
    check(conn.includes('watchLogin'), 'D3c 앱이 로그인 단계에서 대기를 등록한다');
    check(
      /"version":\s*"0\.2\./.test(readFileSync('extension/manifest.json', 'utf8')),
      'D4 규약이 늘었으면 버전도 올라간다 — 앱이 구버전을 구분할 근거가 된다',
    );
    check(
      (manifest.permissions ?? []).length === 2 &&
        manifest.permissions.includes('tabs') &&
        manifest.permissions.includes('scripting'),
      'D5 권한은 늘지 않았다 (tabs·scripting 그대로)',
    );
  }

  // ── E. 화면이 한 번에 한 가지만 시키는가 ──
  //   예전에는 로그인이 필요할 때 버튼이 둘로 갈렸다(로그인하러 가기 · 다시 가져오기).
  {
    check(conn.includes("type Stage"), 'E1 화면 단계가 한 값으로 정해진다');
    const loginBlock = conn.match(/stage === 'login' &&[\s\S]*?\n      \)\}/)?.[0] ?? '';
    check(loginBlock.length > 0, 'E2 로그인 단계 구획을 찾는다');
    const primaryInLogin = (loginBlock.match(/btn-primary/g) ?? []).length;
    check(primaryInLogin === 1, `E3 로그인 단계의 주 버튼은 하나다 (${primaryInLogin}개)`);
    check(
      !loginBlock.includes('다시 가져오기'),
      'E4 "다시 가져오기"를 사용자에게 시키지 않는다 — 돌아온 것은 우리가 감지한다',
    );
    check(
      conn.includes('probeLoginState'),
      'E5 로그인 여부를 확장에 물어본다(탭을 열지 않는 값싼 조회)',
    );
    check(
      conn.includes('onExtensionReady'),
      'E6 확장이 뒤늦게 알려도 받는다 — 처음 탐지 창은 이미 닫혀 있다',
    );
    check(
      conn.includes('MANUAL_AFTER_MISSES'),
      'E7 자동 감지가 빗나가면 수동 확인이 나온다 — 자동화가 막다른 길이면 안 된다',
    );
  }

  // ── F. 다시 읽어도 밟아 온 단계가 남는가 ──
  //   설치 감지가 화면을 다시 읽으므로, 진행이 날아가면 고치려던 것보다 나빠진다.
  {
    check(onboard.includes('sessionStorage'), 'F1 온보딩 진행이 세션에 남는다');
    check(
      onboard.includes('removeItem') || onboard.includes('leave()') || onboard.includes('function leave'),
      'F2 온보딩을 떠날 때는 지운다 — 안 지우면 다음에 마지막 단계에서 시작한다',
    );
  }

  console.log(`verify-ext-autodetect: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
