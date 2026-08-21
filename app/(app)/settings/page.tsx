// 설정 화면 — 지금은 탈퇴 하나뿐이다.
//
// 탈퇴를 사이드바에 바로 걸지 않고 화면을 하나 두는 이유: 로그아웃 옆에 영구 삭제가 붙어
// 있으면 잘못 누르는 사람이 반드시 나온다. 그리고 앞으로 늘어날 계정 설정이 들어올 자리다.
export const metadata = {
  title: '설정 · 이레이지',
};

import { DeleteAccountPanel } from '@/components/DeleteAccountPanel';

export default function SettingsPage() {
  return (
    <>
      <header className="page-head">
        <div className="head-left">
          <h1>설정</h1>
        </div>
      </header>

      <DeleteAccountPanel />
    </>
  );
}
