// 管理员身份校验：通过一个名为 admin_session 的 Cookie 判断是否已登录。

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// 是否为已登录的管理员
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return store.get("admin_session")?.value === process.env.ADMIN_SESSION_SECRET;
}

// 要求必须是管理员，否则跳转到登录页（保护后台页面用）
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }
}
