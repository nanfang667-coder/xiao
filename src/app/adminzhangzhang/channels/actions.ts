"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parsePromotionChannelDetails,
  parsePromotionChannelInput,
} from "@/lib/promotion-channel-input";

export type ChannelActionState = { error?: string; success?: string };

function invalidId(id: unknown): boolean {
  return typeof id !== "string" || !/^c[a-z0-9]{24}$/.test(id);
}

function databaseError(error: unknown): ChannelActionState {
  const code = typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
  if (code === "P2002") return { error: "渠道标识或短链域名已存在，请换一个后重试。" };
  if (code === "P2025") return { error: "该渠道不存在，请刷新页面。" };
  if (code === "P2021") return { error: "渠道功能尚未完成数据库更新，请先完成部署。" };
  return { error: "保存失败，请稍后重试。" };
}

export async function createPromotionChannel(
  _state: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireAdmin();
  if (!(formData instanceof FormData)) return { error: "渠道信息无效。" };
  let data;
  try {
    data = parsePromotionChannelInput(formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "渠道信息无效。" };
  }
  try {
    await prisma.promotionChannel.create({ data, select: { id: true } });
  } catch (error) {
    return databaseError(error);
  }
  revalidatePath("/adminzhangzhang/channels");
  return { success: "渠道已创建，请将短域名重定向到下方显示的地址。" };
}

export async function updatePromotionChannel(
  id: string,
  _state: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireAdmin();
  if (invalidId(id)) return { error: "渠道编号无效。" };
  if (!(formData instanceof FormData)) return { error: "渠道信息无效。" };
  let data;
  try {
    data = parsePromotionChannelDetails(formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "渠道信息无效。" };
  }
  try {
    await prisma.promotionChannel.update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    return databaseError(error);
  }
  revalidatePath("/adminzhangzhang/channels");
  return { success: "渠道信息已保存。" };
}

export async function setPromotionChannelActive(
  id: string,
  _state: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  await requireAdmin();
  if (invalidId(id)) return { error: "渠道编号无效。" };
  const value = formData instanceof FormData ? formData.get("isActive") : null;
  if (value !== "true" && value !== "false") return { error: "渠道状态无效。" };
  const isActive = value === "true";
  try {
    await prisma.promotionChannel.update({
      where: { id }, data: { isActive }, select: { id: true },
    });
  } catch (error) {
    return databaseError(error);
  }
  revalidatePath("/adminzhangzhang/channels");
  return { success: isActive ? "已启用，后续访问将计入统计。" : "已停用，链接仍前往首页，后续访问不再计数。" };
}
