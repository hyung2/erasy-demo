import type { Metadata } from "next";
// 디자이너 다크 디자인 정본(SUIT 폰트 @import 포함). 전역 단일 스타일시트.
import "@/theme/erasy-dark.css";
import { SessionProvider } from "next-auth/react";
import { DemoStateClient } from "@/components/DemoStateClient";

export const metadata: Metadata = {
  title: "이레이지(Erasy) 데모 — 흩어진 계정을 되찾다",
  description:
    "흩어진 소셜·해외 계정을 한 화면에 모아 보고, 표준 방식으로 끊고, 유출을 실시간으로 지키는 프라이버시 관리 서비스. 연출 데모(예시 데이터).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: 브라우저 확장(예: HWP `data-hwp-extension`)이 <html>에 주입하는
    //   속성으로 인한 하이드레이션 경고 억제. 이 요소 자체에만 적용 → 자식의 실제 미스매치는 가리지 않음.
    // data-scroll-behavior: CSS scroll-behavior:smooth를 라우트 전환에 명시 opt-in(Next 16 권고).
    <html lang="ko" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        {/* useSession 등 클라이언트 세션 훅용. JWT 세션이라 서버 세션 prop 주입 없이도 동작. */}
        <SessionProvider>
          <DemoStateClient>{children}</DemoStateClient>
        </SessionProvider>
      </body>
    </html>
  );
}
