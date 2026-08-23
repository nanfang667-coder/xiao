"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

function readUrl(formData: FormData): string {
  const value = readText(formData, "url", "网站地址", 500, true);
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入完整网址，例如 https://example.com");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("网站地址只能使用 http:// 或 https://");
  }
  if (url.username || url.password) {
    throw new Error("网站地址不能包含用户名或密码");
  }

  return url.toString();
}

function extractPartnerFields(formData: FormData) {
  const sortOrder = Number(String(formData.get("sortOrder") ?? "").trim() || "100");
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 1 || sortOrder > 9999) {
    throw new Error("排序必须是 1 到 9999 之间的整数");
  }

  const linkType = String(formData.get("linkType") ?? "exchange");
  if (linkType !== "exchange" && linkType !== "sponsored") {
    throw new Error("链接类型无效");
  }

  return {
    name: readText(formData, "name", "合作伙伴名称", 80, true),
    url: readUrl(formData),
    description: readText(formData, "description", "简介", 120) || null,
    linkType,
    sortOrder,
    isPublished: formData.get("isPublished") === "on",
  };
}

function revalidatePartnerPages() {
  revalidatePath("/");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/partners");
}

export async function createPartnerLink(formData: FormData) {
  await requireAdmin();
  await prisma.partnerLink.create({ data: extractPartnerFields(formData) });
  revalidatePartnerPages();
  redirect("/adminzhangzhang/partners");
}

export async function updatePartnerLink(id: number, formData: FormData) {
  await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("合作伙伴编号无效");

  const existing = await prisma.partnerLink.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new Error("合作伙伴不存在");

  await prisma.partnerLink.update({
    where: { id },
    data: extractPartnerFields(formData),
  });
  revalidatePartnerPages();
  redirect("/adminzhangzhang/partners");
}

export async function deletePartnerLink(id: number) {
  await requireAdmin();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("合作伙伴编号无效");

  await prisma.partnerLink.deleteMany({ where: { id } });
  revalidatePartnerPages();
}
