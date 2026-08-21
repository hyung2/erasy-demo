// 약관·방침 공개 레이아웃.
// proxy.ts matcher가 화이트리스트(앱 라우트만 열거)라 이 그룹은 인증 없이 열린다 —
// 웹스토어 심사관과 미가입 방문자가 로그인 없이 읽어야 하므로 그 상태를 유지할 것.
import Link from 'next/link';

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <div className="container legal-header-inner">
          <Link className="legal-logo" href="/">
            이레이지
          </Link>
          <nav className="legal-nav">
            <Link href="/privacy">개인정보처리방침</Link>
            <Link href="/terms">이용약관</Link>
          </nav>
        </div>
      </header>

      <main className="container legal-main">{children}</main>

      <footer className="legal-footer">
        <div className="container">
          <p>이레이지(Erasy)</p>
        </div>
      </footer>
    </div>
  );
}
