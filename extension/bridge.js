// 앱 페이지 ↔ 확장 브리지.
//
// 확장 ID를 쓰지 않는 이유: 개발자 모드로 압축 해제 설치하면 ID가 설치할 때마다 달라진다.
// 앱에 ID를 박아 두면 재설치 한 번에 연동이 끊기고, 시연 직전에 그걸 발견하게 된다.
// 대신 확장이 페이지에 먼저 "나 여기 있다"고 알리고, 이후 window.postMessage로만 오간다.
//
// 경계: 이 스크립트는 앱 도메인에서만 동작하고(manifest matches), 페이지가 보낸 메시지 중
// 우리 규약에 맞는 것만 처리한다. 페이지에 구글 데이터를 노출하는 것은 사용자가 버튼을
// 눌렀을 때 돌려주는 **서비스 이름 배열** 하나뿐이다.

const APP = 'erasy-app';
const EXT = 'erasy-ext';

function announce() {
  // 지원 제공사를 함께 알린다 — 앱이 "가져오기" 버튼을 어느 탭에 띄울지 여기서 갈린다.
  // 셀렉터가 확인되지 않은 제공사는 목록에서 빠지므로, 앱은 없는 기능을 광고하지 않는다.
  chrome.runtime.sendMessage({ type: 'erasy:providers' }, (res) => {
    const providers = chrome.runtime.lastError ? [] : (res?.providers ?? []);
    window.postMessage(
      { source: EXT, type: 'ready', version: '0.2.1', providers },
      window.location.origin,
    );
  });
}

// 앱 스크립트가 늦게 뜰 수 있어 두 번 알린다(즉시 + 로드 완료 후).
announce();
window.addEventListener('load', announce);

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== APP) return;

  if (data.type === 'ping') {
    announce();
    return;
  }

  // "지금 이 제공사 로그인을 기다린다"는 등록/해제. 로그인이 다른 탭에서 감지되면
  // 백그라운드가 이 탭을 앞으로 가져온다. 응답은 필요 없다 — 실패해도 사용자가
  // 직접 돌아오는 기존 경로가 그대로 있다.
  if (data.type === 'login-watch') {
    chrome.runtime.sendMessage(
      { type: 'erasy:loginWatch', provider: data.provider, on: !!data.on },
      () => void chrome.runtime.lastError, // 수신자가 없어도 조용히 — 콘솔 오류를 남길 일이 아니다
    );
    return;
  }

  // 로그인 여부만 묻는다 — 탭을 열지 않는 값싼 조회라 앱이 짧은 주기로 반복해도 된다.
  // 앱은 이 답으로 "로그인하러 가기"를 "한 번에 가져오기"로 바꾼다.
  if (data.type === 'login-state') {
    chrome.runtime.sendMessage({ type: 'erasy:loginState', provider: data.provider }, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage(
        {
          source: EXT,
          type: 'login-state',
          requestId: data.requestId ?? null,
          ok: !err && !!res?.ok,
          loggedIn: err ? null : (res?.loggedIn ?? null),
        },
        window.location.origin,
      );
    });
    return;
  }

  if (data.type === 'collect') {
    chrome.runtime.sendMessage({ type: 'erasy:collect', provider: data.provider }, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage(
        {
          source: EXT,
          type: 'collected',
          requestId: data.requestId ?? null,
          ...(err
            ? { ok: false, error: '확장과 통신하지 못했습니다. 확장을 다시 로드해 주세요.' }
            : (res ?? { ok: false, error: '응답이 비어 있습니다.' })),
        },
        window.location.origin,
      );
    });
  }
});
