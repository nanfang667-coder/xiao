"use server"; // 服务器操作

import { redirect } from "next/navigation";
import { registerUser, loginUser, logoutUser } from "@/lib/user-auth";

// ========== 注册 ==========

export async function register(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // 简单验证（中文需 encodeURIComponent，否则直接进 Location 头会报非法字符 500）
  if (!username || !email || !password) {
    redirect(`/register?error=${encodeURIComponent("请填写所有字段")}`);
  }

  if (password.length < 6) {
    redirect(`/register?error=${encodeURIComponent("密码至少6位")}`);
  }

  try {
    await registerUser({ username, email, password });
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