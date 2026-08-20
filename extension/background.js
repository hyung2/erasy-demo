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

const CONNECTIONS_URL = 'https://myaccount.google.com/connections';
/** 목록이 그려질 때까지 기다리는 상한. 넘으면 빈손으로 정직하게 실패한다. */
const READY_TIMEOUT_MS = 12000;
const POLL_MS = 400;

/**
 * 연결목록 페이지에서 서비스 이름만 뽑는다. **탭 안에서 실행되는 함수**라 외부 스코프를 쓸 수 없다.
 *
 * 셀렉터를 href로 잡는 이유: 클래스명(umngff·IlKlLe 등)은 구글 빌드마다 바뀌는 난독화 값이라
 * 하루 만에 깨진다. `/linkedapps/overview/` 경로는 화면 구조가 바뀌어도 잘 살아남는다.
 */
function extractConnections() {
  const anchors = Array.from(
    document.querySelectorAll('a[href*="linkedapps/overview"]'),
  );
  const names = anchors
    .map((a) => (a.innerText || '').trim().split('\n')[0].trim())
    .filter((s) => s.length > 0 && s.length <= 60);
  return Array.from(new Set(names));
}

/** 목록이 실제로 그려졌는지 — SPA라 로드 완료와 렌더 완료가 다르다. */
function hasConnections() {
  return document.querySelectorAll('a[href*="linkedapps/overview"]').length > 0;
}

async function waitForRender(tabId) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: hasConnections,
      });
      if (res?.result) return true;
    } catch {
      // 탭이 아직 스크립트를 받을 준비가 안 된 상태 — 다음 폴에서 다시 본다.
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

async function collectConnections() {
  // 눈에 띄지 않게 뒤에서 연다. 사용자가 보던 화면을 빼앗지 않는다.
  const tab = await chrome.tabs.create({ url: CONNECTIONS_URL, active: false });
  try {
    const rendered = await waitForRender(tab.id);
    if (!rendered) {
      return {
        ok: false,
        error:
          '연결목록을 읽지 못했습니다. 구글에 로그인되어 있는지 확인한 뒤 다시 시도해 주세요.',
      };
    }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractConnections,
    });
    const names = res?.result ?? [];
    return names.length > 0
      ? { ok: true, names }
      : { ok: false, error: '연결된 서비스를 찾지 못했습니다.' };
  } catch (e) {
    return { ok: false, error: `가져오기에 실패했습니다. (${e?.message ?? 'unknown'})` };
  } finally {
    // 읽고 나면 바로 닫는다. 열어 둘 이유가 없고, 열린 채 두면 사용자가 놀란다.
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* 이미 닫혔으면 그만이다 */
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'erasy:collect') return false;
  collectConnections().then(sendResponse);
  return true; // 비동기 응답
});
