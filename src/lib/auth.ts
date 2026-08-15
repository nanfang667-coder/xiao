// 管理员身份校验：Cookie 只保存随机会话令牌，数据库只保存其哈希。

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateAdminSession } from "@/lib/admin-session";
import { ADMIN_SESSION_COOKIE_NAME } from "@/lib/admin-session-token";

// 是否为已登录的管理员
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return validateAdminSession(store.get(ADMIN_SESSION_COOKIE_NAME)?.value);
}

// 要求必须是管理员，否则跳转到登录页（保护后台页面用）
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    redirect("/adminzhangzhang/login");
  }
}
