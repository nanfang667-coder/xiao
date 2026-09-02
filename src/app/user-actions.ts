"use server"; // 服务器操作

import { redirect } from "next/navigation";
import { registerUser, loginUser, logoutUser } from "@/lib/user-auth";
import {
  GENERIC_LOGIN_ERROR,
  validateLoginForm,
  validateRegistrationForm,
} from "@/lib/user-auth-input";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { getCurrentSite } from "@/lib/site";

// ========== 注册 ==========

export async function register(formData: FormData) {
  const site = await getCurrentSite();
  // 防止脚本批量刷注册：同一 IP 一小时最多注册 5 次。
  // ip 为 "unknown"（拿不到真实 IP，比如 Nginx 没配 X-Forwarded-For 转发）时跳过限流，
  // 避免全站访客被当成同一个人、一人超限所有人遭殃。
  const ip = await getClientIp();
  if (ip !== "unknown" && !checkRateLimit(`register:${site.id}:${ip}`, 5, 60 * 60 * 1000)) {
    redirect(`/register?error=${encodeURIComponent("注册过于频繁，请1小时后再试")}`);
  }

  const validation = validateRegistrationForm(formData);
  if (!validation.success) {
    redirect(`/register?error=${encodeURIComponent(validation.error)}`);
  }
  const { username, password } = validation.data;

  try {
    await registerUser({ username, password }, ip);
    // 注册成功后自动登录
    await loginUser({ usernameOrEmail: username, password });
  } catch (error) {
    const message =
      error instanceof Error &&
      [
        "用户名已存在",
        "邮箱已被注册",
        "检测到批量注册，账号已被限制，请联系管理员",
      ].includes(error.message)
        ? error.message
        : "注册失败，请稍后重试";
    redirect(`/register?error=${encodeURIComponent(message)}`);
  }

  // 成功后跳首页。必须放在 try/catch 之外：
  // redirect() 靠抛 NEXT_REDIRECT 异常实现，若写在 try 内会被 catch 误当作错误吞掉。
  redirect("/");
}

// ========== 登录 ==========

export async function login(formData: FormData) {
  const site = await getCurrentSite();
  // 防止脚本批量试密码：同一 IP 15 分钟最多尝试 20 次。
  // ip 为 "unknown" 时跳过限流（原因同 register，避免误伤全站访客）。
  const ip = await getClientIp();
  if (ip !== "unknown" && !checkRateLimit(`login:${site.id}:${ip}`, 20, 15 * 60 * 1000)) {
    redirect(`/login?error=${encodeURIComponent("尝试次数过多，请15分钟后再试")}`);
  }

  const validation = validateLoginForm(formData);
  if (!validation.success) {
    redirect(`/login?error=${encodeURIComponent(validation.error)}`);
  }

  try {
    await loginUser(validation.data);
  } catch {
    redirect(`/login?error=${encodeURIComponent(GENERIC_LOGIN_ERROR)}`);
  }

  // 成功后跳首页（放在 try/catch 之外，避免 redirect 的 NEXT_REDIRECT 异常被 catch 吞掉）
  redirect("/");
}

// ========== 登出 ==========

export async function logout() {
  await logoutUser();
  redirect("/login");
}
