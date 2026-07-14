import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const SITE_URL = "https://gp77.top";

// Sitemap metadata routes are cached by default. Generate this one per request so
// newly created, updated, or deleted teachers are reflected immediately.
export const dynamic = "force-dynamic";

type SitemapTeacher = {
  id: number;
  city: string;
  district: string;
  createdAt: Date;
};

function locationUrl(province: string, city?: string): string {
  const url = new URL(SITE_URL);
  url.searchParams.set("province", province);
  if (city) url.searchParams.set("city", city);

  // Next.js 16.2.10 writes sitemap URLs directly into <loc> without XML escaping.
  // XML parsers decode &amp; back to &, so crawlers still request the real URL.
  return url.toString().replaceAll("&", "&amp;");
}

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

  const provinceDates = new Map<string, Date>();
  const cityDates = new Map<string, { province: string; city: string; lastModified: Date }>();
  let siteLastModified: Date | undefined;

  for (const teacher of teachers) {
    siteLastModified = newestDate(siteLastModified, teacher.createdAt);

    const province = teacher.city.trim();
    const city = teacher.district.trim();
    if (!province) continue;

    provinceDates.set(
      province,
      newestDate(provinceDates.get(province), teacher.createdAt),
    );

    if (city) {
      const key = `${province}\u0000${city}`;
      const existing = cityDates.get(key);
      cityDates.set(key, {
        province,
        city,
        lastModified: newestDate(existing?.lastModified, teacher.createdAt),
      });
    }
  }

  const locationEntries: MetadataRoute.Sitemap = [
    ...[...provinceDates.entries()].map(([province, lastModified]) => ({
      url: locationUrl(province),
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...[...cityDates.values()].map(({ province, city, lastModified }) => ({
      url: locationUrl(province, city),
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

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
    ...locationEntries,
    ...teacherEntries,
  ];
}
