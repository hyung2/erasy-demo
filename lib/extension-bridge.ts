// 브라우저 확장과의 통신 — 확장이 설치돼 있을 때만 열리는 자동 수집 경로.
//
// 왜 있는가: 3사가 연결앱 목록 API를 열지 않아 서버가 물어볼 곳이 없다. 남은 합법 경로는
// 붙여넣기와 "사용자 본인 브라우저가 자기 화면을 읽기" 둘뿐이고, 확장이 후자다.
// 확장이 없으면 이 경로는 조용히 닫히고 화면은 기존 붙여넣기만 보여준다 —
// 설치하지 않은 사람에게 없는 버튼을 보여 주면 그게 곧 미완성 인상이 된다.
//
// 확장 ID를 쓰지 않는다: 압축 해제 설치는 ID가 매번 바뀐다. 확장이 먼저 ready를 알리고
// 이후 window.postMessage로만 오간다(lib/../extension/bridge.js와 같은 규약).

const APP = 'erasy-app';
const EXT = 'erasy-ext';

type ExtMessage =
  | { source: typeof EXT; type: 'ready'; version?: string; providers?: string[] }
  | {
      source: typeof EXT;
      type: 'collected';
      requestId: string | null;
      ok: boolean;
      names?: string[];
      error?: string;
      needsLogin?: boolean;
      loginUrl?: string | null;
    };

function isExtMessage(v: unknown): v is ExtMessage {
  return typeof v === 'object' && v !== null && (v as { source?: unknown }).source === EXT;
}

/**
 * 확장 설치 주소(미등록 게재 — 검색에는 뜨지 않고 링크로만 들어간다).
 *
 * 화면이 이 주소를 알아야 하는 이유: 예전에는 확장이 없으면 원터치 경로를 통째로 숨겼다.
 * 웹스토어에 올라가기 전이라 보낼 곳이 없었고, 눌러도 안 되는 버튼을 보여 주는 것보다는
 * 나았다. 게재가 끝난 뒤에도 그 처리가 남아 있어서, **확장을 모르는 사람은 이 제품의
 * 주 경로를 만날 길이 자체가 없었다**(2026-08-27 발견).
 */
export const EXTENSION_STORE_URL =
  'https://chromewebstore.google.com/detail/bkdbefmikkiillaiaidlmghijkeflhck';

/**
 * 확장이 있는지, 어느 제공사를 자동으로 가져올 수 있는지 확인한다.
 *
 * 확장은 페이지 로드 시 스스로 ready를 보내지만 앱이 그보다 늦게 뜨면 그 신호를 놓친다
 * — 그래서 ping을 한 번 던지고 짧게 기다린다.
 *
 * providers를 함께 받는 이유: 셀렉터가 확인되지 않은 제공사까지 버튼을 띄우면 사용자는
 * 눌러 보고 실패만 겪는다. 확장이 "지금 되는 곳"만 알려 주고 앱은 그대로 따른다.
 */
export function detectExtension(timeoutMs = 800): Promise<string[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string[]) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve(v);
    };
    function onMessage(e: MessageEvent) {
      if (e.source !== window || !isExtMessage(e.data)) return;
      if (e.data.type === 'ready') finish(e.data.providers ?? []);
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: APP, type: 'ping' }, window.location.origin);
    setTimeout(() => finish([]), timeoutMs);
  });
}

export type CollectResult =
  | { ok: true; names: string[] }
  // needsLogin이면 화면이 "먼저 로그인하세요 + 로그인 페이지 열기"를 보여준다.
  // 그냥 실패로 뭉뚱그리면 사용자는 무엇이 문제인지 모른 채 같은 버튼만 다시 누른다.
  | { ok: false; error: string; needsLogin?: boolean; loginUrl?: string | null };

/**
 * 확장에 수집을 요청한다. 확장이 백그라운드 탭으로 연결목록 페이지를 열어 **서비스 이름만**
 * 읽고 탭을 닫는다. 아이디·비밀번호는 이 경로 어디에서도 다루지 않는다.
 */
export function collectViaExtension(
  provider: string,
  timeoutMs = 25000,
): Promise<CollectResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: '브라우저에서만 사용할 수 있습니다.' });
  }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: CollectResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve(v);
    };
    function onMessage(e: MessageEvent) {
      if (e.source !== window || !isExtMessage(e.data)) return;
      if (e.data.type !== 'collected') return;
      if (e.data.requestId && e.data.requestId !== requestId) return;
      finish(
        e.data.ok && e.data.names?.length
          ? { ok: true, names: e.data.names }
          : {
              ok: false,
              error: e.data.error ?? '목록을 가져오지 못했습니다.',
              needsLogin: e.data.needsLogin ?? false,
              loginUrl: e.data.loginUrl ?? null,
            },
      );
    }
    window.addEventListener('message', onMessage);
    window.postMessage(
      { source: APP, type: 'collect', requestId, provider },
      window.location.origin,
    );
    setTimeout(
      () => finish({ ok: false, error: '시간이 초과됐습니다. 다시 시도해 주세요.' }),
      timeoutMs,
    );
  });
}
