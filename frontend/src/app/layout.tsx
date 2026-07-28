import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SailFish ระบบวิเคราะห์การแข่งขัน",
  description: "ระบบติดตามและวิเคราะห์การแข่งขันเรือใบ",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
