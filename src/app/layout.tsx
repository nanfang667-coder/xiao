import type { Metadata } from "next";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";
import { SiteVisitTracker } from "@/components/SiteVisitTracker";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getCurrentSite();
  const origin = siteOrigin(site);
  const description = `${site.name}汇集全国各城市公开的地区信息`;
  return {
    metadataBase: new URL(origin),
    title: site.name,
    description,
    applicationName: site.name,
    openGraph: {
      title: site.name,
      description,
      url: origin,
      siteName: site.name,
      locale: "zh_CN",
      type: "website",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SiteVisitTracker />
        {children}
      </body>
    </html>
  );
}
