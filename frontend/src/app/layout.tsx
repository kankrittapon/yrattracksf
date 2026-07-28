import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";

const sail = Prompt({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sail",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SailFish · สมาคมเรือใบแห่งประเทศไทย",
  description: "ระบบติดตามและวิเคราะห์การแข่งขันเรือใบ สำหรับสมาคมเรือใบแห่งประเทศไทย (YRAT)",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="th" className={sail.variable}>
      <body>{children}</body>
    </html>
  );
}
