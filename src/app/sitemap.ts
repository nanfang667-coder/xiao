import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getSeoLocationsForRecord, getSeoLocationUrl } from "@/lib/location-seo";
import { MIN_ACCESSIBLE_LOCATION_RECORDS, SITE_URL } from "@/lib/site-config";

// Sitemap metadata routes are cached by default. Generate this one per request so
// newly created, updated, or deleted teachers are reflected immediately.
export const dynamic = "force-dynamic";

type SitemapTeacher = {
  id: number;
  city: string;
  district: string;
  createdAt: Date;
};

function newestDate(current: Date | undefined, candidate: Date): Date {
  return !current || candidate > current ? candidate : current;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  const locationStats = new Map<
    string,
    { url: string; count: number; lastModified: Date }
  >();
  let siteLastModified: Date | undefined;

  for (const teacher of teachers) {
    siteLastModified = newestDate(siteLastModified, teacher.createdAt);

    for (const location of getSeoLocationsForRecord(teacher.city, teacher.district)) {
      const url = getSeoLocationUrl(location, SITE_URL);
      const existing = locationStats.get(url);
      locationStats.set(url, {
        url,
        count: (existing?.count ?? 0) + 1,
        lastModified: newestDate(existing?.lastModified, teacher.createdAt),
      });
    }
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
    url: `${SITE_URL}/teacher/${teacher.id}`,
    lastModified: teacher.createdAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [
    {
      url: `${SITE_URL}/`,
      ...(siteLastModified ? { lastModified: siteLastModified } : {}),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/fenglou`,
      ...(siteLastModified ? { lastModified: siteLastModified } : {}),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...locationEntries,
    ...teacherEntries,
  ];
}
