import type { Metadata, Viewport } from "next";
import { Jua } from "next/font/google";
import "./globals.css";

const jua = Jua({ weight: "400", subsets: ["latin"], variable: "--font-jua", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "춘천 꼬마 3D 메이커",
  description: "앱 설치 없이 브라우저에서 바로 만드는 초등학생용 노코드 3D 프린팅 메이커",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#fde68a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={jua.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
