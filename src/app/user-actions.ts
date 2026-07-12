"use server"; // 服务器操作

import { redirect } from "next/navigation";
import { registerUser, loginUser, logoutUser } from "@/lib/user-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

// ========== 注册 ==========

export async function register(formData: FormData) {
  // 防止脚本批量刷注册：同一 IP 一小时最多注册 5 次。
  // ip 为 "unknown"（拿不到真实 IP，比如 Nginx 没配 X-Forwarded-For 转发）时跳过限流，
  // 避免全站访客被当成同一个人、一人超限所有人遭殃。
  const ip = await getClientIp();
  if (ip !== "unknown" && !checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000)) {
    redirect(`/register?error=${encodeURIComponent("注册过于频繁，请1小时后再试")}`);
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // 简单验证（中文需 encodeURIComponent，否则直接进 Location 头会报非法字符 500）
  if (!username || !password || !confirmPassword) {
    redirect(`/register?error=${encodeURIComponent("请填写所有字段")}`);
  }

  if (password.length < 6) {
    redirect(`/register?error=${encodeURIComponent("密码至少6位")}`);
  }

  if (password !== confirmPassword) {
    redirect(`/register?error=${encodeURIComponent("两次输入的密码不一致")}`);
  }

  try {
    await registerUser({ username, password }, ip);
    // 注册成功后自动登录
    await loginUser({ usernameOrEmail: username, password });
  } catch (error: any) {
    // 显示具体错误信息
    redirect(`/register?error=${encodeURIComponent(error.message)}`);
  }

  // 成功后跳首页。必须放在 try/catch 之外：
  // redirect() 靠抛 NEXT_REDIRECT 异常实现，若写在 try 内会被 catch 误当作错误吞掉。
  redirect("/");
}

// ========== 登录 ==========

export async function login(formData: FormData) {
  // 防止脚本批量试密码：同一 IP 15 分钟最多尝试 20 次。
  // ip 为 "unknown" 时跳过限流（原因同 register，避免误伤全站访客）。
  const ip = await getClientIp();
  if (ip !== "unknown" && !checkRateLimit(`login:${ip}`, 20, 15 * 60 * 1000)) {
    redirect(`/login?error=${encodeURIComponent("尝试次数过多，请15分钟后再试")}`);
  }

  const usernameOrEmail = String(formData.get("usernameOrEmail") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!usernameOrEmail || !password) {
    redirect(`/login?error=${encodeURIComponent("请填写账号和密码")}`);
  }

  try {
    await loginUser({ usernameOrEmail, password });
  } catch (error: any) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // 成功后跳首页（放在 try/catch 之外，避免 redirect 的 NEXT_REDIRECT 异常被 catch 吞掉）
  redirect("/");
}

// ========== 登出 ==========

export async function logout() {
  await logoutUser();
  redirect("/login");
}