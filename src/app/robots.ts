import type { MetadataRoute } from "next";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getCurrentSite();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${siteOrigin(site)}/sitemap.xml`,
  };
}
