import { prisma } from "@/lib/prisma";

export type PartnerLinkType = "exchange" | "sponsored";

export type PublicPartnerLink = {
  id: number;
  name: string;
  url: string;
  description: string | null;
  linkType: PartnerLinkType;
};

export type AdminPartnerLink = PublicPartnerLink & {
  sortOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeLinkType(value: string): PartnerLinkType {
  return value === "sponsored" ? "sponsored" : "exchange";
}

export async function getPublishedPartnerLinks(): Promise<PublicPartnerLink[]> {
  const links = await prisma.partnerLink.findMany({
    where: { isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, url: true, description: true, linkType: true },
  });

  return links.map((link) => ({ ...link, linkType: normalizeLinkType(link.linkType) }));
}

export async function getPartnerLinksForAdmin(): Promise<AdminPartnerLink[]> {
  const links = await prisma.partnerLink.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  return links.map((link) => ({ ...link, linkType: normalizeLinkType(link.linkType) }));
}

export async function getPartnerLinkByIdForAdmin(id: string): Promise<AdminPartnerLink | null> {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

  const link = await prisma.partnerLink.findUnique({ where: { id: numericId } });
  return link ? { ...link, linkType: normalizeLinkType(link.linkType) } : null;
}
