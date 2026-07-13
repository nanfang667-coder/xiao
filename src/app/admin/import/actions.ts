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

export async function importLfgTeacher(formData: FormData) {
  await requireAdmin();
  const cid = Number(formData.get("cid"));
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error("无效的信息 ID");
  const existing = await prisma.teacher.findFirst({ where: { source: SOURCE, sourceId: cid }, select: { id: true } });
  if (existing) redirect(`/admin/${existing.id}/edit`);

  const detail = await getLfgDetail(cid);
  if (detail.cid !== cid) throw new Error("上游 API 返回了不匹配的信息 ID");
  const location = await getCityName(detail.shi_id);
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
      source: SOURCE, sourceId: cid,
    },
  });
  revalidatePath("/"); revalidatePath("/admin"); revalidatePath("/admin/teachers");
  redirect(`/admin/${teacher.id}/edit`);
}
