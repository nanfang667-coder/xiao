import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  FALLBACK_SITE,
  normalizeHostname,
  type SiteConfig,
} from "@/lib/site-utils";

function toSiteConfig(site: {
  id: string;
  hostname: string;
  name: string;
  singlePostPrice: number;
  membershipPrice: number;
  membershipOriginalPrice: number;
}): SiteConfig {
  return site;
}

export async function getSiteByHostname(
  rawHostname: string | null | undefined,
): Promise<SiteConfig> {
  const hostname = normalizeHostname(rawHostname);
  if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
    const matched = await prisma.site.findFirst({
      where: { hostname, isActive: true },
      select: {
        id: true,
        hostname: true,
        name: true,
        singlePostPrice: true,
        membershipPrice: true,
        membershipOriginalPrice: true,
      },
    });
    if (matched) return toSiteConfig(matched);
  }

  const fallback = await prisma.site.findFirst({
    where: { isDefault: true, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      hostname: true,
      name: true,
      singlePostPrice: true,
      membershipPrice: true,
      membershipOriginalPrice: true,
    },
  });
  return fallback ? toSiteConfig(fallback) : FALLBACK_SITE;
}

export const getCurrentSite = cache(async (): Promise<SiteConfig> => {
  const requestHeaders = await headers();
  return getSiteByHostname(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
});
