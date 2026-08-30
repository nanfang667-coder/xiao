"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteAlleyDetailPhotos,
  saveAlleyDetailPhotos,
} from "@/lib/alley-media";
import { requireAdmin } from "@/lib/auth";
import { saveUploadedPhotos } from "@/lib/image-upload";
import { prisma } from "@/lib/prisma";
import { deleteUploadedPhotos } from "@/lib/uploaded-photos";

function readText(
  formData: FormData,
  name: string,
  label: string,
  maxLength: number,
): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`${label}不能为空`);
  if (value.length > maxLength)
    throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return value;
}

function readOptionalText(
  formData: FormData,
  name: string,
  label: string,
  maxLength: number,
): string {
  const value = String(formData.get(name) ?? "").trim();
  if (value.length > maxLength)
    throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return value;
}

function selectedFiles(formData: FormData, name: string): File[] {
  return formData
    .getAll(name)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

function extractFields(formData: FormData) {
  const sortOrder = Number(
    String(formData.get("sortOrder") ?? "").trim() || "100",
  );
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 1 || sortOrder > 9999) {
    throw new Error("排序必须是 1 到 9999 之间的整数");
  }

  return {
    title: readText(formData, "title", "标题", 120),
    city: readText(formData, "city", "省份", 40),
    district: readText(formData, "district", "城市／地区", 60),
    address: readOptionalText(formData, "address", "详细地址", 300),
    description: readText(formData, "description", "详细介绍", 10000),
    sortOrder,
    isPublished: formData.get("isPublished") === "on",
  };
}

function revalidateAlleyPages(id?: number) {
  revalidatePath("/alley");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/alleys");
  revalidatePath("/sitemap.xml");
  if (id) revalidatePath(`/alley/${id}`);
}

export async function createAlley(formData: FormData) {
  await requireAdmin();
  const fields = extractFields(formData);
  const coverFiles = selectedFiles(formData, "coverPhoto");
  const detailFiles = selectedFiles(formData, "detailPhotos");
  if (coverFiles.length > 1) throw new Error("列表封面图最多上传 1 张");

  let coverUrls: string[] = [];
  let detailNames: string[] = [];
  try {
    coverUrls = await saveUploadedPhotos(coverFiles);
    detailNames = await saveAlleyDetailPhotos(detailFiles);
    const alley = await prisma.alleyPost.create({
      data: {
        ...fields,
        coverPhoto: coverUrls[0] ?? "",
        detailPhotos: JSON.stringify(detailNames),
      },
    });
    revalidateAlleyPages(alley.id);
  } catch (error) {
    await deleteUploadedPhotos(JSON.stringify(coverUrls));
    await deleteAlleyDetailPhotos(detailNames);
    throw error;
  }

  redirect("/adminzhangzhang/alleys");
}

export async function updateAlley(id: number, formData: FormData) {
  await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("暗巷编号无效");

  const existing = await prisma.alleyPost.findUnique({ where: { id } });
  if (!existing) throw new Error("暗巷信息不存在");

  const fields = extractFields(formData);
  const coverFiles = selectedFiles(formData, "coverPhoto");
  const detailFiles = selectedFiles(formData, "detailPhotos");
  if (coverFiles.length > 1) throw new Error("列表封面图只能上传 1 张");

  let coverUrls: string[] = [];
  let detailNames: string[] = [];
  try {
    if (coverFiles.length === 1)
      coverUrls = await saveUploadedPhotos(coverFiles);
    if (detailFiles.length > 0)
      detailNames = await saveAlleyDetailPhotos(detailFiles);

    await prisma.alleyPost.update({
      where: { id },
      data: {
        ...fields,
        ...(coverUrls.length > 0 ? { coverPhoto: coverUrls[0] } : {}),
        ...(detailNames.length > 0
          ? { detailPhotos: JSON.stringify(detailNames) }
          : {}),
      },
    });
  } catch (error) {
    await deleteUploadedPhotos(JSON.stringify(coverUrls));
    await deleteAlleyDetailPhotos(detailNames);
    throw error;
  }

  if (coverUrls.length > 0) {
    await deleteUploadedPhotos(JSON.stringify([existing.coverPhoto]));
  }
  if (detailNames.length > 0)
    await deleteAlleyDetailPhotos(existing.detailPhotos);
  revalidateAlleyPages(id);
  redirect("/adminzhangzhang/alleys");
}

export async function deleteAlley(id: number) {
  await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("暗巷编号无效");

  const existing = await prisma.alleyPost.findUnique({ where: { id } });
  if (!existing) return;

  await prisma.alleyPost.delete({ where: { id } });
  await deleteUploadedPhotos(JSON.stringify([existing.coverPhoto]));
  await deleteAlleyDetailPhotos(existing.detailPhotos);
  revalidateAlleyPages(id);
}
