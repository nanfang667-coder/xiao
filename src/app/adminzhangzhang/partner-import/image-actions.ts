"use server";

import { requireAdmin } from "@/lib/auth";
import { collectPartnerPageImages, partnerImagesMessage, planPartnerImageBatch } from "@/lib/partner-images";

export async function planPartnerImages(sourceId: number, pageUrl: string, mode: "list" | "detail" | "three", pageNumber = 1) {
  await requireAdmin();
  try { return await planPartnerImageBatch(sourceId, pageUrl, mode, pageNumber); }
  catch (error) { return { error: partnerImagesMessage(error) }; }
}

export async function fetchPartnerImages(sourceId: number, detailUrl: string, photoHints?: unknown) {
  await requireAdmin();
  try { return { photos: await collectPartnerPageImages(sourceId, detailUrl, photoHints) }; }
  catch (error) { return { error: partnerImagesMessage(error) }; }
}
