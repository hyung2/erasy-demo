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
  window.postMessage({ source: EXT, type: 'ready', version: '0.1.0' }, window.location.origin);
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

  if (data.type === 'collect') {
    chrome.runtime.sendMessage({ type: 'erasy:collect' }, (res) => {
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
