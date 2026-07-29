import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import Script from "next/script";
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

const themeInitScript = `try{var t=localStorage.getItem("sailfish-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="th" className={sail.variable}>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">{themeInitScript}</Script>
        {children}
      </body>
    </html>
  );
}
