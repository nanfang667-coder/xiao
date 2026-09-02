import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import {
  getSeoLocationsForRecord,
  getSeoLocationUrl,
} from "@/lib/location-seo";
import { MIN_ACCESSIBLE_LOCATION_RECORDS } from "@/lib/site-config";
import { ALLEY_PUBLIC_ENABLED } from "@/lib/feature-flags";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";

// Sitemap metadata routes are cached by default. Generate this one per request so
// newly created, updated, or deleted teachers are reflected immediately.
export const dynamic = "force-dynamic";

type SitemapTeacher = {
  id: number;
  city: string;
  district: string;
  createdAt: Date;
};
type SitemapMerchant = {
  id: number;
  updatedAt: Date;
};
type SitemapAlley = {
  id: number;
  updatedAt: Date;
};

function newestDate(current: Date | undefined, candidate: Date): Date {
  return !current || candidate > current ? candidate : current;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getCurrentSite();
  const origin = siteOrigin(site);
  // Only select fields that are already exposed by public listing/detail URLs.
  // Contact details and all other teacher data must never enter the sitemap.
  const teachers: SitemapTeacher[] = await prisma.teacher.findMany({
    select: {
      id: true,
      city: true,
      district: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });
  const merchants: SitemapMerchant[] = await prisma.merchant.findMany({
    where: { isPublished: true },
    select: { id: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  const alleys: SitemapAlley[] = ALLEY_PUBLIC_ENABLED
    ? await prisma.alleyPost.findMany({
        where: { isPublished: true },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      })
    : [];

  const locationStats = new Map<
    string,
    { url: string; count: number; lastModified: Date }
  >();
  let siteLastModified: Date | undefined;

  for (const teacher of teachers) {
    siteLastModified = newestDate(siteLastModified, teacher.createdAt);

    for (const location of getSeoLocationsForRecord(
      teacher.city,
      teacher.district,
    )) {
      const url = getSeoLocationUrl(location, origin);
      const existing = locationStats.get(url);
      locationStats.set(url, {
        url,
        count: (existing?.count ?? 0) + 1,
        lastModified: newestDate(existing?.lastModified, teacher.createdAt),
      });
    }
  }
  for (const merchant of merchants) {
    siteLastModified = newestDate(siteLastModified, merchant.updatedAt);
  }
  for (const alley of alleys) {
    siteLastModified = newestDate(siteLastModified, alley.updatedAt);
  }

  const locationEntries: MetadataRoute.Sitemap = [...locationStats.values()]
    .filter((entry) => entry.count >= MIN_ACCESSIBLE_LOCATION_RECORDS)
    .sort((left, right) => left.url.localeCompare(right.url))
    .map(({ url, lastModified }) => ({
      url,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));

  const teacherEntries: MetadataRoute.Sitemap = teachers.map((teacher) => ({
    url: `${origin}/listing/${teacher.id}`,
    lastModified: teacher.createdAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  const merchantEntries: MetadataRoute.Sitemap = merchants.map((merchant) => ({
    url: `${origin}/spa/${merchant.id}`,
    lastModified: merchant.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  const alleyEntries: MetadataRoute.Sitemap = alleys.map((alley) => ({
    url: `${origin}/alley/${alley.id}`,
    lastModified: alley.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [
    {
      url: `${origin}/`,
      ...(siteLastModified ? { lastModified: siteLastModified } : {}),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${origin}/fenglou`,
      ...(siteLastModified ? { lastModified: siteLastModified } : {}),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...(ALLEY_PUBLIC_ENABLED
      ? [
          {
            url: `${origin}/alley`,
            ...(siteLastModified ? { lastModified: siteLastModified } : {}),
            changeFrequency: "daily" as const,
            priority: 0.8,
          },
        ]
      : []),
    {
      url: `${origin}/spa`,
      ...(siteLastModified ? { lastModified: siteLastModified } : {}),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${origin}/safety`,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    ...locationEntries,
    ...teacherEntries,
    ...merchantEntries,
    ...alleyEntries,
  ];
}
