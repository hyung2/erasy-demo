// 연결목록 수집 — 백그라운드 탭에서 사용자 본인 세션으로 읽고 곧바로 닫는다.
//
// 왜 확장인가
//   구글·카카오·네이버는 "연결된 서비스" 목록을 외부 API로 열지 않는다(T1.1 전수 확인).
//   그래서 서버가 물어볼 곳이 없다. 남은 합법 경로는 두 가지뿐이었다 —
//   (1) 사용자가 화면에서 복사해 붙여넣기, (2) 사용자 본인 브라우저가 자기 화면을 읽기.
//   계정 위임(대리 로그인)은 약관·정보통신망법에서 깨지므로 처음부터 배제했다.
//   이 확장은 (2)다. 사용자가 이미 로그인해 둔 세션으로 자기 페이지를 읽을 뿐,
//   자격증명은 어디에서도 다루지 않고 우리 서버는 이 과정에 개입하지 않는다.
//
// 무엇을 읽는가
//   서비스 이름 문자열뿐이다. 링크의 토큰·아이콘·계정 식별자는 가져오지 않는다.

/** 목록이 그려질 때까지 기다리는 상한. 넘으면 빈손으로 정직하게 실패한다. */
const READY_TIMEOUT_MS = 15000;
const POLL_MS = 400;

/**
 * 제공사별 수집 규약.
 *
 * selector를 **클래스가 아니라 구조·경로**로 잡는 이유: 3사 모두 클래스명이 빌드마다 바뀌는
 * 난독화 값이다(구글 실측 — umngff·IlKlLe). 경로나 역할 속성이 훨씬 오래 산다.
 *
 * selector가 null인 제공사는 아직 실제 DOM을 확인하지 못한 곳이다. 지어낸 셀렉터를 넣으면
 * 사용자는 "가져오기 실패"만 반복해서 보게 되므로, 확인 전까지는 그 경로를 열지 않는다.
 */
// 목록을 열었는데 로그인 화면으로 튕기면 그때 URL이 이 패턴이 된다.
// 감지해서 **바로** 알린다 — 렌더 대기 상한(15초)을 다 기다린 뒤 "읽지 못했습니다"라고
// 말하면 사용자는 무엇이 문제인지 모른 채 시간만 쓴다.
const LOGIN_URL_PATTERNS = [
  /accounts\.google\.com\/(signin|ServiceLogin|v3\/signin)/i,
  /accounts\.kakao\.com\/login/i,
  /nid\.naver\.com\/nidlogin/i,
  /nid\.naver\.com\/user2\/V2Login/i,
];

const PROVIDERS = {
  google: {
    label: '구글',
    urls: ['https://myaccount.google.com/connections'],
    selector: 'a[href*="linkedapps/overview"]',
    loginUrl: 'https://accounts.google.com/signin',
  },
  kakao: {
    label: '카카오',
    // 카카오는 연결 서비스가 **탭마다 다른 페이지**로 갈려 있다(카카오서비스 / 제휴 / 외부).
    // 한 곳만 읽으면 나머지가 통째로 빠지는데 화면은 "다 가져왔다"고 보이므로,
    // 미발견이 조용히 생긴다 — 그래서 탭별 주소를 모두 돈다.
    urls: [
      'https://apps.kakao.com/connected/app/list?lang=ko&service_type=kakao', // 카카오서비스
      'https://apps.kakao.com/connected/app/list?lang=ko&service_type=partner', // 제휴 서비스
      'https://apps.kakao.com/connected/app/list?lang=ko&service_type=open', // 외부 서비스
    ],
    // `/list`를 빼는 이유: 탭 링크(`/connected/app/list?service_type=…`)가 같은 경로를 쓴다.
    // 그대로 두면 "제휴 서비스" 같은 **탭 이름이 서비스명으로 섞여 들어온다.**
    selector: 'a[href*="apps.kakao.com/connected/app/"]:not([href*="/list"])',
    // 항목 안에 "상세보기 이동" 같은 보조 텍스트가 같이 들어 있어, 서비스명이 담긴
    // 요소를 직접 집는다.
    nameSelector: 'strong',
    // continue 없는 /login은 카카오가 400으로 튕긴다(실측 307 → /v2/error/400).
    // 로그인 후 연결목록에 내려 주도록 continue를 붙인다.
    loginUrl:
      'https://accounts.kakao.com/login?continue=' +
      encodeURIComponent('https://apps.kakao.com/connected/app/list?lang=ko&service_type=kakao'),
  },
  naver: {
    label: '네이버',
    // 이력관리 > 연결된 서비스 관리. 구글·카카오는 링크 목록인데 여기는 표(table)다.
    //
    // 셀렉터를 `service_title` 하나로 좁힌 이유: 처음에 구조 기반 대체 셀렉터(`td.site strong`)를
    // 함께 걸었더니 **같은 페이지의 로그인 이력 표까지 긁어** 날짜 문자열 22건이 계정으로
    // 들어왔다(2026-08-20 실측). 넓은 셀렉터는 클래스 변경에는 강하지만 오탐에는 약하고,
    // 이 제품에서 오탐은 "없는 계정을 있다고 말하는 것"이라 미발견보다 나쁘다.
    urls: ['https://nid.naver.com/internalToken/view/tokenList/pc/ko'],
    selector: 'strong.service_title',
    // 파라미터 없는 nidlogin.login은 오류 화면이 섞여 나온다(실측 503). url로 목록 화면을 준다.
    loginUrl:
      'https://nid.naver.com/nidlogin.login?url=' +
      encodeURIComponent('https://nid.naver.com/internalToken/view/tokenList/pc/ko'),
  },
};

/**
 * 이레이지 앱이 열려 있는 탭 — 설치 직후 여기를 다시 읽게 한다.
 *
 * 왜: 크롬은 **이미 열려 있는 탭에 content script를 나중에 주입하지 않는다.** 그래서
 * 설치를 마치고 앱으로 돌아와도 그 탭에는 브리지가 없고, 앱은 확장이 없는 것으로 본다.
 * 사용자에게는 "설치했는데 아무 일도 안 일어나는" 화면이다. 확장이 스스로 그 탭을 한 번
 * 새로 읽어 주면 그때부터 원터치 경로가 열린다 — 사용자가 새로고침을 배울 이유가 없다.
 */
const APP_TAB_MATCHES = ['https://service-app-seven-virid.vercel.app/*', 'http://localhost/*'];

chrome.runtime.onInstalled.addListener((details) => {
  // 'update'는 제외한다. 크롬이 알아서 올리는 자동 업데이트까지 새로고침하면 사용자가
  // 쓰고 있던 화면을 예고 없이 날린다.
  if (details?.reason !== 'install') return;
  chrome.tabs.query({ url: APP_TAB_MATCHES }, (tabs) => {
    if (chrome.runtime.lastError) return;
    for (const t of tabs ?? []) {
      if (t.id != null) chrome.tabs.reload(t.id);
    }
  });
});

/**
 * 3사 로그인 여부 — 값싼 조회용 메모리 캐시. null은 "아직 모른다"다.
 *
 * 이걸 두는 이유: 로그인이 필요하다고 알린 뒤, 사용자가 다른 탭에서 로그인하고 돌아왔을 때
 * 화면이 스스로 바뀌어야 한다. 확인하겠다고 매번 백그라운드 탭을 여는 것은 값이 비싸고,
 * 사용자 브라우저를 우리가 마음대로 쓰는 일이다.
 *
 * 무엇을 보는가: 탭 주소가 아래 세 제공사 패턴에 맞는지만 본다. 맞지 않는 주소는 그대로
 * 버리고, 남기는 것은 제공사별 참/거짓 세 개뿐이다. 방문 기록을 모으지 않고 저장하지도
 * 않는다(서비스 워커가 잠들면 사라진다).
 */
const loginState = { google: null, kakao: null, naver: null };

/** 그 제공사에 로그인돼 있어야만 열리는 주소들. 여기 있으면 로그인된 것으로 본다. */
const SIGNED_IN_DOMAINS = {
  google: /^https:\/\/myaccount\.google\.com\//i,
  kakao: /^https:\/\/(apps|accounts)\.kakao\.com\//i,
  naver: /^https:\/\/nid\.naver\.com\//i,
};

/** 로그인 화면. 위 도메인보다 **먼저** 본다 — 카카오·네이버는 같은 도메인에 로그인 화면이 있다. */
const SIGN_IN_PAGES = {
  google: /^https:\/\/accounts\.google\.com\/(signin|ServiceLogin|v3\/signin)/i,
  kakao: /^https:\/\/accounts\.kakao\.com\/login/i,
  naver: /^https:\/\/nid\.naver\.com\/(nidlogin|user2\/V2Login)/i,
};

function noteTabUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return;
  for (const key of Object.keys(SIGN_IN_PAGES)) {
    if (SIGN_IN_PAGES[key].test(url)) {
      loginState[key] = false;
      return;
    }
  }
  for (const key of Object.keys(SIGNED_IN_DOMAINS)) {
    if (SIGNED_IN_DOMAINS[key].test(url)) {
      loginState[key] = true;
      return;
    }
  }
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) noteTabUrl(changeInfo.url);
});

/** 셀렉터와 대상 주소가 모두 확인된 제공사만 앱에 알린다. 둘 중 하나라도 없으면 열지 않는다. */
function supportedProviders() {
  return Object.entries(PROVIDERS)
    .filter(([, v]) => typeof v.selector === 'string' && (v.urls?.length ?? 0) > 0)
    .map(([k]) => k);
}

/**
 * 목록에서 서비스 이름만 뽑는다. **탭 안에서 실행되는 함수**라 외부 스코프를 쓸 수 없어
 * 셀렉터를 인자로 받는다.
 */
function extractNames(selector, nameSelector) {
  // 서비스명으로 볼 수 없는 값 — 셀렉터가 조금만 넓어도 표의 다른 열이 딸려 온다.
  //   여기서 거르지 않으면 "2026. 04. 10." 같은 날짜가 계정으로 저장되고, 사용자는
  //   자기가 가입한 적 없는 것을 자기 계정으로 읽는다. 미발견보다 나쁜 실패다.
  const looksLikeService = (s) => {
    if (s.length === 0 || s.length > 60) return false;
    if (/^\d+$/.test(s)) return false; // 순번·건수
    if (/^\d{4}[.\-/]\s?\d{1,2}[.\-/]/.test(s)) return false; // 날짜
    if (/^\d+\+$/.test(s)) return false; // 알림 배지(99+)
    if (/copyright|all rights reserved/i.test(s)) return false; // 푸터
    if (/^(미상|높음|보통|낮음|정보 입력|정리|상세보기|더보기|전체)/.test(s)) return false;
    return true;
  };

  const nodes = Array.from(document.querySelectorAll(selector));
  const names = nodes
    .map((el) => {
      // 서비스명 요소를 직접 집을 수 있으면 그쪽이 정확하다. 없으면 첫 줄로 떨어진다
      // — 항목 안에는 "상세보기 이동" 같은 보조 텍스트가 함께 들어 있다.
      const target = nameSelector ? el.querySelector(nameSelector) : null;
      const raw = (target?.innerText ?? target?.textContent ?? el.innerText ?? '').trim();
      return raw.split('\n')[0].trim();
    })
    .filter(looksLikeService);
  return Array.from(new Set(names));
}

/** 목록이 실제로 그려졌는지 — SPA라 로드 완료와 렌더 완료가 다르다. */
function countNodes(selector) {
  return document.querySelectorAll(selector).length;
}

/** 지금 이 탭이 로그인 화면으로 튕겼는가. 튕겼으면 더 기다릴 이유가 없다. */
async function isLoginRedirect(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab?.url ?? '';
    return LOGIN_URL_PATTERNS.some((re) => re.test(url));
  } catch {
    return false;
  }
}

/** 렌더 대기 결과 — 'ready' 목록 나옴 · 'login' 로그인 필요 · 'timeout' 그 외 실패. */
async function waitForRender(tabId, selector) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // 로그인 화면이면 즉시 끝낸다. 상한을 다 기다린 뒤 "읽지 못했습니다"라고 말하면
    // 사용자는 무엇이 문제인지 모른 채 15초를 버린다.
    if (await isLoginRedirect(tabId)) return 'login';
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: countNodes,
        args: [selector],
      });
      if ((res?.result ?? 0) > 0) return 'ready';
    } catch {
      // 탭이 아직 스크립트를 받을 준비가 안 된 상태 — 다음 폴에서 다시 본다.
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return (await isLoginRedirect(tabId)) ? 'login' : 'timeout';
}

/** 한 페이지에서 이름을 읽는다. 실패해도 던지지 않는다 — 나머지 페이지는 계속 읽어야 한다. */
async function collectFromUrl(url, selector, nameSelector) {
  // 눈에 띄지 않게 뒤에서 연다. 사용자가 보던 화면을 빼앗지 않는다.
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    const state = await waitForRender(tab.id, selector);
    if (state !== 'ready') return { ok: false, needsLogin: state === 'login', names: [] };
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractNames,
      args: [selector, nameSelector ?? null],
    });
    return { ok: true, needsLogin: false, names: res?.result ?? [] };
  } catch {
    return { ok: false, needsLogin: false, names: [] };
  } finally {
    // 읽고 나면 바로 닫는다. 열어 둘 이유가 없고, 열린 채 두면 사용자가 놀란다.
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* 이미 닫혔으면 그만이다 */
    }
  }
}

async function collect(providerKey) {
  const provider = PROVIDERS[providerKey];
  if (!provider) return { ok: false, error: '알 수 없는 제공사입니다.' };
  if (!provider.selector || (provider.urls?.length ?? 0) === 0) {
    return {
      ok: false,
      error: `${provider.label} 자동 가져오기는 아직 지원하지 않습니다. 목록을 복사해 붙여넣어 주세요.`,
    };
  }

  // 목록이 여러 페이지로 갈려 있으면 전부 돈다(카카오는 탭마다 다른 주소다).
  // 한 곳이 실패해도 멈추지 않되, **몇 곳을 못 읽었는지는 반드시 알린다** —
  // 조용히 일부만 가져오면 사용자는 그게 전부인 줄 안다.
  const all = [];
  let failed = 0;
  let needsLogin = false;
  for (const url of provider.urls) {
    const r = await collectFromUrl(url, provider.selector, provider.nameSelector);
    if (!r.ok) failed += 1;
    if (r.needsLogin) {
      // 로그인이 필요하면 나머지 주소도 마찬가지다. 탭을 더 열지 않는다.
      needsLogin = true;
      break;
    }
    all.push(...r.names);
  }
  const names = Array.from(new Set(all));

  if (needsLogin) {
    // 실측이 추측을 이긴다 — 방금 열어 보고 로그인 화면으로 튕겼으니 확실하다.
    loginState[providerKey] = false;
    return {
      ok: false,
      needsLogin: true,
      provider: providerKey,
      loginUrl: provider.loginUrl ?? null,
      error: `${provider.label}에 로그인되어 있지 않습니다. 먼저 로그인하시면 연결목록을 가져올 수 있어요.`,
    };
  }

  if (names.length === 0) {
    return {
      ok: false,
      error: `${provider.label} 연결목록을 읽지 못했습니다. 로그인되어 있는지 확인한 뒤 다시 시도해 주세요.`,
    };
  }
  loginState[providerKey] = true;
  return {
    ok: true,
    provider: providerKey,
    names,
    // 부분 실패를 숨기지 않는다. 앱이 이 값을 받아 사용자에게 그대로 알린다.
    partial: failed > 0 ? { failed, total: provider.urls.length } : null,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'erasy:providers') {
    sendResponse({ ok: true, providers: supportedProviders() });
    return false;
  }
  if (msg?.type === 'erasy:loginState') {
    const key = msg.provider ?? 'google';
    sendResponse({ ok: true, provider: key, loggedIn: loginState[key] ?? null });
    return false;
  }
  if (msg?.type === 'erasy:collect') {
    collect(msg.provider ?? 'google').then(sendResponse);
    return true; // 비동기 응답
  }
  return false;
});
