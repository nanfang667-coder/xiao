"use server"; // 这个文件里的函数都在服务器上运行（安全，能读数据库、存文件）

import { unlink } from "fs/promises";
import path from "path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { emojiFor, defaultGradients } from "@/lib/photo";
import { saveUploadedPhotos } from "@/lib/image-upload";
import { createAdminSession, revokeAdminSession } from "@/lib/admin-session";
import {
  canAttemptAdminLogin,
  recordAdminLoginFailure,
} from "@/lib/admin-login-limit";
import { isAdminPasswordValid } from "@/lib/admin-login-limit-token";
import { getClientIp } from "@/lib/request-ip";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIES_TO_CLEAR,
  ADMIN_SESSION_COOKIE_PATH,
  ADMIN_SESSION_LEGACY_COOKIE_NAME,
  ADMIN_SESSION_LEGACY_COOKIE_PATH,
  ADMIN_SESSION_TTL_SECONDS,
} from "@/lib/admin-session-token";

// ========== 登录 / 登出 ==========

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const clientIp = await getClientIp();

  // 密码不对，回到登录页并带上错误提示
  if (!(await canAttemptAdminLogin(clientIp))) {
    redirect("/adminzhangzhang/login?error=rate-limit");
  }

  if (!isAdminPasswordValid(password, process.env.ADMIN_PASSWORD)) {
    const result = await recordAdminLoginFailure(clientIp);
    if (result.newlyBlockedScopes.length > 0) {
      console.warn("Administrator login rate limit activated", {
        scopes: result.newlyBlockedScopes,
      });
    }
    redirect(
      `/adminzhangzhang/login?error=${result.blocked ? "rate-limit" : "invalid"}`,
    );
  }

  // 密码正确后创建可单独撤销的随机会话；Cookie 不包含服务器密钥。
  const session = await createAdminSession();
  const store = await cookies();
  // Expire the legacy root-scoped cookie before setting the scoped session.
  store.set(ADMIN_SESSION_LEGACY_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    path: ADMIN_SESSION_LEGACY_COOKIE_PATH,
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
    priority: "high",
  });
  store.set(ADMIN_SESSION_COOKIE_NAME, session.token, {
    httpOnly: true, // 前端 JS 读不到，更安全
    sameSite: "strict",
    path: ADMIN_SESSION_COOKIE_PATH,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    expires: session.expiresAt,
    secure: process.env.NODE_ENV === "production",
    priority: "high",
  });

  redirect("/adminzhangzhang");
}

export async function logout() {
  const store = await cookies();
  await revokeAdminSession(store.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  for (const cookie of ADMIN_SESSION_COOKIES_TO_CLEAR) {
    store.set(cookie.name, "", {
      httpOnly: true,
      sameSite: "strict",
      path: cookie.path,
      maxAge: 0,
      secure: process.env.NODE_ENV === "production",
      priority: "high",
    });
  }
  redirect("/adminzhangzhang/login");
}

// ========== 保存上传的图片 ==========

// 删除已上传到 public/uploads 的图片文件（占位色块字符串会跳过）
async function deleteUploadedPhotos(photosJson: string) {
  let photos: string[] = [];
  try {
    photos = JSON.parse(photosJson);
  } catch {
    return;
  }
  for (const p of photos) {
    if (typeof p === "string" && p.startsWith("/uploads/")) {
      const filename = p.slice("/uploads/".length);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename)) continue;
      try {
        await unlink(path.join(process.cwd(), "public", "uploads", filename));
      } catch {
        // 文件不存在或已删除，忽略
      }
    }
  }
}

// 从表单里提取老师的文字字段
function parseChinaDateTime(value: FormDataEntryValue | null): Date | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const parsed = new Date(`${text}:00+08:00`);
  if (Number.isNaN(parsed.getTime()))
    throw new Error("\u63a8\u5e7f\u65f6\u95f4\u683c\u5f0f\u4e0d\u6b63\u786e");
  return parsed;
}

function extractFields(formData: FormData) {
  const ageRaw = String(formData.get("age") ?? "").trim();
  const promotionStartsAt = parseChinaDateTime(
    formData.get("promotionStartsAt"),
  );
  const promotionEndsAt = parseChinaDateTime(formData.get("promotionEndsAt"));
  const promotionOrder = Number(
    String(formData.get("promotionOrder") ?? "").trim() || "100",
  );
  if (
    !Number.isSafeInteger(promotionOrder) ||
    promotionOrder < 1 ||
    promotionOrder > 9999
  ) {
    throw new Error(
      "\u5e7f\u544a\u6392\u5e8f\u5fc5\u987b\u662f 1 \u5230 9999 \u4e4b\u95f4\u7684\u6574\u6570",
    );
  }

  if (
    promotionStartsAt &&
    promotionEndsAt &&
    promotionEndsAt <= promotionStartsAt
  ) {
    throw new Error(
      "\u63a8\u5e7f\u7ed3\u675f\u65f6\u95f4\u5fc5\u987b\u665a\u4e8e\u5f00\u59cb\u65f6\u95f4",
    );
  }

  return {
    name: String(formData.get("name") ?? "").trim(),
    type: String(formData.get("type") ?? "钢琴"),
    city: String(formData.get("city") ?? "").trim(),
    district: String(formData.get("district") ?? "").trim(),
    price: String(formData.get("price") ?? "").trim(),
    services: String(formData.get("services") ?? "").trim(),
    courseNotes: String(formData.get("courseNotes") ?? "").trim(),
    age: ageRaw || null,
    phone: String(formData.get("phone") ?? "").trim(),
    wechat: String(formData.get("wechat") ?? "").trim(),
    qq: String(formData.get("qq") ?? "").trim(),
    otherContact: String(formData.get("otherContact") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    isNationallyPromoted: formData.get("isNationallyPromoted") === "on",
    promotionOrder,
    promotionStartsAt,
    promotionEndsAt,
  };
}

// ========== 增 / 改 / 删 ==========

export async function createTeacher(formData: FormData) {
  await requireAdmin();
  const fields = extractFields(formData);

  const files = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File);
  const uploaded = await saveUploadedPhotos(files);
  // 没上传图片就用默认占位色块
  const photos = uploaded.length > 0 ? uploaded : defaultGradients(fields.type);

  await prisma.teacher.create({
    data: {
      ...fields,
      photos: JSON.stringify(photos),
      emoji: emojiFor(fields.type),
    },
  });

  // 通知相关页面刷新缓存
  revalidatePath("/");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/teachers");
  redirect("/adminzhangzhang/teachers");
}

export async function updateTeacher(
  id: number,
  returnTo: string,
  formData: FormData,
) {
  await requireAdmin();
  const fields = extractFields(formData);

  const files = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File);
  const uploaded = await saveUploadedPhotos(files);

  // 如果这次没上传新图片，就保留原来的图片
  let photos: string[];
  if (uploaded.length > 0) {
    photos = uploaded;
  } else {
    const existing = await prisma.teacher.findUnique({ where: { id } });
    try {
      photos = existing
        ? JSON.parse(existing.photos)
        : defaultGradients(fields.type);
    } catch {
      photos = defaultGradients(fields.type);
    }
  }

  await prisma.teacher.update({
    where: { id },
    data: {
      ...fields,
      photos: JSON.stringify(photos),
      emoji: emojiFor(fields.type),
    },
  });

  revalidatePath("/");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/teachers");
  revalidatePath(`/listing/${id}`);
  const safeReturnTo =
    returnTo === "/adminzhangzhang/teachers" ||
    returnTo.startsWith("/adminzhangzhang/teachers?")
      ? returnTo
      : "/adminzhangzhang/teachers";
  redirect(safeReturnTo);
}

export async function deleteTeacher(id: number) {
  await requireAdmin();
  const existing = await prisma.teacher.findUnique({ where: { id } });
  await prisma.teacher.delete({ where: { id } });
  if (existing) await deleteUploadedPhotos(existing.photos); // 顺带清理图片文件
  revalidatePath("/");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/teachers");
}

// ========== 用户管理 ==========

// 开通会员（可选传入有效期天数，不传表示永久）
export async function grantMembership(id: number, formData: FormData) {
  await requireAdmin();
  const days = Number(formData.get("days") ?? 0);
  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  // 只有"从非会员变成会员"才算新增，给已是会员的人延期不重置这个时间
  const existing = await prisma.user.findUnique({ where: { id } });

  await prisma.user.update({
    where: { id },
    data: {
      isMember: true,
      membershipExpiresAt: expiresAt,
      ...(existing && !existing.isMember ? { memberSince: new Date() } : {}),
    },
  });

  revalidatePath("/adminzhangzhang/users");
}

// 取消会员
export async function revokeMembership(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { isMember: false, membershipExpiresAt: null },
  });
  revalidatePath("/adminzhangzhang/users");
}

// 封禁用户（管理员手动封禁；批量注册触发的自动封禁见 src/lib/user-auth.ts）
export async function banUser(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { isBanned: true, bannedAt: new Date(), banReason: "管理员手动封禁" },
  });
  revalidatePath("/adminzhangzhang/users");
}

// 解封用户
export async function unbanUser(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { isBanned: false, bannedAt: null, banReason: null },
  });
  revalidatePath("/adminzhangzhang/users");
}

// 删除用户
export async function deleteUser(id: number) {
  await requireAdmin();
  const orders = await prisma.order.findMany({
    where: { userId: id },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  // 清理与该用户相关的佣金（他作为推荐人赚的、或他的订单产生的）、提现申请、订单，避免孤儿记录
  await prisma.commission.deleteMany({
    where: { OR: [{ referrerId: id }, { orderId: { in: orderIds } }] },
  });
  await prisma.withdrawal.deleteMany({ where: { userId: id } });
  await prisma.order.deleteMany({ where: { userId: id } });
  await prisma.user.updateMany({
    where: { referredBy: id },
    data: { referredBy: null },
  }); // 避免遗留悬空引用
  await prisma.user.delete({ where: { id } });
  revalidatePath("/adminzhangzhang/users");
}

// ========== 推广提现管理 ==========

// 标记提现已发放（人工转完 USDT 后点击）
export async function markWithdrawalPaid(id: number) {
  await requireAdmin();
  await prisma.withdrawal.update({
    where: { id },
    data: { status: "paid", paidAt: new Date() },
  });
  revalidatePath("/adminzhangzhang/withdrawals");
}

// 驳回提现申请：解除关联的佣金记录，恢复用户的可提现余额
export async function rejectWithdrawal(id: number) {
  await requireAdmin();
  await prisma.$transaction(async (tx) => {
    await tx.commission.updateMany({
      where: { withdrawalId: id },
      data: { withdrawalId: null },
    });
    await tx.withdrawal.update({
      where: { id },
      data: { status: "rejected" },
    });
  });
  revalidatePath("/adminzhangzhang/withdrawals");
}
