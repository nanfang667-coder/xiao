import { prisma } from "@/lib/prisma";

export type Merchant = {
  id: number;
  name: string;
  city: string;
  district: string;
  price: string | null;
  services: string;
  description: string | null;
  photos: string[];
  phone: string | null;
  wechat: string | null;
  qq: string | null;
  otherContact: string | null;
  address: string | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function parsePhotos(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((photo): photo is string => typeof photo === "string")
      : [];
  } catch {
    return [];
  }
}

function toMerchant(row: Omit<Merchant, "photos"> & { photos: string }): Merchant {
  return {
    ...row,
    photos: parsePhotos(row.photos),
  };
}

export async function getPublishedMerchants(): Promise<Merchant[]> {
  const rows = await prisma.merchant.findMany({
    where: { isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map(toMerchant);
}

export async function getPublishedMerchantById(id: string): Promise<Merchant | null> {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

  const row = await prisma.merchant.findFirst({
    where: { id: numericId, isPublished: true },
  });

  return row ? toMerchant(row) : null;
}

export async function getMerchantByIdForAdmin(id: string): Promise<Merchant | null> {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

  const row = await prisma.merchant.findUnique({ where: { id: numericId } });
  return row ? toMerchant(row) : null;
}

export async function getMerchantsForAdmin(): Promise<Merchant[]> {
  const rows = await prisma.merchant.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map(toMerchant);
}
