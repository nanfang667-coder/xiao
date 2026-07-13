"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultGradients, emojiFor } from "@/lib/photo";
import { getCityName, getLfgDetail } from "@/lib/lfg-api";

const SOURCE = "lfgapi";
function inferType(text: string) {
  return /舞|瑜伽|形体|健身|操/.test(text) ? "舞蹈" : "钢琴";
}

const MAX_BULK_IMPORTS = 10;

async function importOne(cid: number): Promise<{ status: "imported" | "skipped"; id: number }> {
  const existing = await prisma.teacher.findFirst({
    where: { source: SOURCE, sourceId: cid },
    select: { id: true },
  });
  if (existing) return { status: "skipped", id: existing.id };

  const detail = await getLfgDetail(cid);
  if (detail.cid !== cid) throw new Error("上游 API 返回了不匹配的信息 ID");

  let location = { province: "未知", city: `地区 ${detail.shi_id}` };
  try {
    location = await getCityName(detail.shi_id);
  } catch {
    // 地区字典是免费辅助接口；即使它临时失败，也保留已付费取得的详情。
  }

  const type = inferType(`${detail.title} ${detail.service ?? ""}`);
  const otherContact = [
    detail.telegram?.trim() ? `Telegram：${detail.telegram.trim()}` : "",
    detail.yuni?.trim() ? `与你号：${detail.yuni.trim()}` : "",
  ].filter(Boolean).join("；");
  const remotePhotos = detail.images?.filter((url) => /^https:\/\//i.test(url)) ?? [];

  const teacher = await prisma.teacher.create({
    data: {
      name: detail.title?.trim() || `老师 ${cid}`,
      type,
      city: location.province,
      district: location.city,
      price: detail.cost?.trim() || "请咨询",
      services: detail.service?.trim() || detail.intro?.trim() || "暂无介绍",
      courseNotes: detail.intro?.trim() || null,
      age: detail.age?.trim() || null,
      photos: JSON.stringify(remotePhotos.length ? remotePhotos : defaultGradients(type)),
      emoji: emojiFor(type),
      phone: detail.tel?.trim() || "",
      wechat: detail.weixin?.trim() || "",
      qq: detail.qq?.trim() || null,
      otherContact: otherContact || null,
      address: detail.address?.trim() || null,
      createdAt: detail.datetime ? new Date(detail.datetime * 1000) : new Date(),
      source: SOURCE,
      sourceId: cid,
    },
  });
  return { status: "imported", id: teacher.id };
}

export async function importLfgTeacher(formData: FormData) {
  await requireAdmin();
  const cid = Number(formData.get("cid"));
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error("无效的信息 ID");

  const result = await importOne(cid);
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/teachers");
  redirect(`/admin/${result.id}/edit`);
}

export async function importSelectedLfgTeachers(formData: FormData) {
  await requireAdmin();
  const cids = [...new Set(
    formData.getAll("cids")
      .map(Number)
      .filter((cid) => Number.isSafeInteger(cid) && cid > 0),
  )];
  if (cids.length === 0) throw new Error("请至少选择一条信息");
  if (cids.length > MAX_BULK_IMPORTS) {
    throw new Error(`单次最多导入 ${MAX_BULK_IMPORTS} 条信息`);
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const cid of cids) {
    try {
      const result = await importOne(cid);
      if (result.status === "imported") imported += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/teachers");
  revalidatePath("/admin/import");

  const rawPage = Number(formData.get("page"));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  redirect(`/admin/import?page=${page}&imported=${imported}&skipped=${skipped}&failed=${failed}`);
}
