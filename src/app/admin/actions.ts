"use server"; // 这个文件里的函数都在服务器上运行（安全，能读数据库、存文件）

import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { emojiFor, defaultGradients } from "@/lib/photo";

// ========== 登录 / 登出 ==========

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  // 密码不对，回到登录页并带上错误提示
  if (password !== process.env.ADMIN_PASSWORD) {
    redirect("/admin/login?error=1");
  }

  // 密码正确，写入登录凭证 Cookie（有效期 7 天）
  const store = await cookies();
  store.set("admin_session", process.env.ADMIN_SESSION_SECRET!, {
    httpOnly: true, // 前端 JS 读不到，更安全
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect("/admin");
}

export async function logout() {
  const store = await cookies();
  store.delete("admin_session");
  redirect("/admin/login");
}

// ========== 保存上传的图片 ==========

// 把上传的图片文件存到 public/uploads/ 下，返回它们的网址（如 /uploads/xxx.jpg）
async function savePhotos(files: File[]): Promise<string[]> {
  const urls: string[] = [];
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true }); // 确保文件夹存在

  for (const file of files) {
    if (!file || file.size === 0) continue; // 跳过空的
    const ext = path.extname(file.name) || ".jpg";
    const filename = `${crypto.randomUUID()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), buffer);
    urls.push(`/uploads/${filename}`);
  }

  return urls;
}

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
      try {
        await unlink(path.join(process.cwd(), "public", p));
      } catch {
        // 文件不存在或已删除，忽略
      }
    }
  }
}

// 从表单里提取老师的文字字段
function extractFields(formData: FormData) {
  const ageRaw = String(formData.get("age") ?? "").trim();

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
  };
}

// ========== 增 / 改 / 删 ==========

export async function createTeacher(formData: FormData) {
  await requireAdmin();
  const fields = extractFields(formData);

  const files = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const uploaded = await savePhotos(files);
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
  revalidatePath("/admin");
  revalidatePath("/admin/teachers");
  redirect("/admin/teachers");
}

export async function updateTeacher(id: number, returnTo: string, formData: FormData) {
  await requireAdmin();
  const fields = extractFields(formData);

  const files = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const uploaded = await savePhotos(files);

  // 如果这次没上传新图片，就保留原来的图片
  let photos: string[];
  if (uploaded.length > 0) {
    photos = uploaded;
  } else {
    const existing = await prisma.teacher.findUnique({ where: { id } });
    try {
      photos = existing ? JSON.parse(existing.photos) : defaultGradients(fields.type);
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
  revalidatePath("/admin");
  revalidatePath("/admin/teachers");
  revalidatePath(`/teacher/${id}`);
  const safeReturnTo =
    returnTo === "/admin/teachers" || returnTo.startsWith("/admin/teachers?")
      ? returnTo
      : "/admin/teachers";
  redirect(safeReturnTo);
}

export async function deleteTeacher(id: number) {
  await requireAdmin();
  const existing = await prisma.teacher.findUnique({ where: { id } });
  await prisma.teacher.delete({ where: { id } });
  if (existing) await deleteUploadedPhotos(existing.photos); // 顺带清理图片文件
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/teachers");
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

  revalidatePath("/admin/users");
}

// 取消会员
export async function revokeMembership(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { isMember: false, membershipExpiresAt: null },
  });
  revalidatePath("/admin/users");
}

// 封禁用户（管理员手动封禁；批量注册触发的自动封禁见 src/lib/user-auth.ts）
export async function banUser(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { isBanned: true, bannedAt: new Date(), banReason: "管理员手动封禁" },
  });
  revalidatePath("/admin/users");
}

// 解封用户
export async function unbanUser(id: number) {
  await requireAdmin();
  await prisma.user.update({
    where: { id },
    data: { isBanned: false, bannedAt: null, banReason: null },
  });
  revalidatePath("/admin/users");
}

// 删除用户
export async function deleteUser(id: number) {
  await requireAdmin();
  const orders = await prisma.order.findMany({ where: { userId: id }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  // 清理与该用户相关的佣金（他作为推荐人赚的、或他的订单产生的）、提现申请、订单，避免孤儿记录
  await prisma.commission.deleteMany({
    where: { OR: [{ referrerId: id }, { orderId: { in: orderIds } }] },
  });
  await prisma.withdrawal.deleteMany({ where: { userId: id } });
  await prisma.order.deleteMany({ where: { userId: id } });
  await prisma.user.updateMany({ where: { referredBy: id }, data: { referredBy: null } }); // 避免遗留悬空引用
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
}

// ========== 推广提现管理 ==========

// 标记提现已发放（人工转完 USDT 后点击）
export async function markWithdrawalPaid(id: number) {
  await requireAdmin();
  await prisma.withdrawal.update({
    where: { id },
    data: { status: "paid", paidAt: new Date() },
  });
  revalidatePath("/admin/withdrawals");
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
  revalidatePath("/admin/withdrawals");
}
