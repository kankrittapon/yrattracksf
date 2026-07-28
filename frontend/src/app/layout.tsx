import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SailFish Race Intelligence",
  description: "Private sailing race telemetry and wind intelligence",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
