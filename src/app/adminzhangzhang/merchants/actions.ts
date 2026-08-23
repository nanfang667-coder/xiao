"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSelectedPhotoFiles, saveUploadedPhotos } from "@/lib/image-upload";
import { prisma } from "@/lib/prisma";
import { deleteUploadedPhotos } from "@/lib/uploaded-photos";

function readText(
  formData: FormData,
  name: string,
  label: string,
  maxLength: number,
  required = false,
): string {
  const value = String(formData.get(name) ?? "").trim();
  if (required && !value) throw new Error(`${label}不能为空`);
  if (value.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return value;
}

function extractMerchantFields(formData: FormData) {
  const sortOrder = Number(String(formData.get("sortOrder") ?? "").trim() || "100");
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 1 || sortOrder > 9999) {
    throw new Error("排序必须是 1 到 9999 之间的整数");
  }

  return {
    name: readText(formData, "name", "商家名称", 80, true),
    city: readText(formData, "city", "省份", 40),
    district: readText(formData, "district", "城市", 60),
    price: readText(formData, "price", "价格", 100) || null,
    services: readText(formData, "services", "服务项目", 2000, true),
    description: readText(formData, "description", "商家介绍", 5000) || null,
    phone: readText(formData, "phone", "电话", 100) || null,
    wechat: readText(formData, "wechat", "微信", 100) || null,
    qq: readText(formData, "qq", "QQ", 100) || null,
    otherContact: readText(formData, "otherContact", "其他联系方式", 200) || null,
    address: readText(formData, "address", "详细地址", 300) || null,
    sortOrder,
    isPublished: formData.get("isPublished") === "on",
  };
}

function revalidateMerchantPages(id?: number) {
  revalidatePath("/spa");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/merchants");
  revalidatePath("/sitemap.xml");
  if (id) revalidatePath(`/spa/${id}`);
}

export async function createMerchant(formData: FormData) {
  await requireAdmin();
  const fields = extractMerchantFields(formData);
  const uploaded = await saveUploadedPhotos(getSelectedPhotoFiles(formData));

  try {
    const merchant = await prisma.merchant.create({
      data: {
        ...fields,
        photos: JSON.stringify(uploaded),
      },
    });
    revalidateMerchantPages(merchant.id);
  } catch (error) {
    await deleteUploadedPhotos(JSON.stringify(uploaded));
    throw error;
  }

  redirect("/adminzhangzhang/merchants");
}

export async function updateMerchant(id: number, formData: FormData) {
  await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("商家编号无效");

  const existing = await prisma.merchant.findUnique({ where: { id } });
  if (!existing) throw new Error("商家不存在");

  const fields = extractMerchantFields(formData);
  const uploaded = await saveUploadedPhotos(getSelectedPhotoFiles(formData));

  try {
    await prisma.merchant.update({
      where: { id },
      data: {
        ...fields,
        ...(uploaded.length > 0 ? { photos: JSON.stringify(uploaded) } : {}),
      },
    });
  } catch (error) {
    await deleteUploadedPhotos(JSON.stringify(uploaded));
    throw error;
  }

  if (uploaded.length > 0) await deleteUploadedPhotos(existing.photos);
  revalidateMerchantPages(id);
  redirect("/adminzhangzhang/merchants");
}

export async function deleteMerchant(id: number) {
  await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("商家编号无效");

  const existing = await prisma.merchant.findUnique({ where: { id } });
  if (!existing) return;

  await prisma.merchant.delete({ where: { id } });
  await deleteUploadedPhotos(existing.photos);
  revalidateMerchantPages(id);
}
