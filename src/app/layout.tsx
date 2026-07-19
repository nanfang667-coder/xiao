import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: "凤楼汇集全国各城市公开的地区信息",
  applicationName: SITE_NAME,
  openGraph: {
    title: SITE_NAME,
    description: "凤楼汇集全国各城市公开的地区信息",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "zh_CN",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
