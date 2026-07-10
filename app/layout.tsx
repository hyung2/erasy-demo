import type { Metadata } from "next";
// 디자이너 다크 디자인 정본(SUIT 폰트 @import 포함). 전역 단일 스타일시트.
import "@/theme/erasy-dark.css";
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
    <html lang="ko">
      <body>
        <DemoStateClient>{children}</DemoStateClient>
      </body>
    </html>
  );
}
