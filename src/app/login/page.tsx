// 用户登录页面
// 功能：支持用户名或邮箱登录

import Link from "next/link";
import { getCurrentUser } from "@/lib/user-auth";
import { login } from "../user-actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await getCurrentUser();

  // 如果已登录，重定向到首页
  if (user) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-600">您已登录</p>
          <Link href="/" className="mt-4 inline-block text-sm text-pink-500">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">用户登录</h1>
        <p className="mt-1 text-sm text-gray-500">登录后可以浏览地区信息</p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <form action={login} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              用户名或邮箱
            </label>
            <input
              type="text"
              name="usernameOrEmail"
              placeholder="请输入用户名或邮箱"
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            />
            <p className="mt-1 text-xs text-gray-400">支持用户名或邮箱登录</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              密码
            </label>
            <input
              type="password"
              name="password"
              placeholder="请输入密码"
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600"
          >
            登录
          </button>
        </form>

        <div className="mt-4 text-center">
          <p className="text-sm text-gray-500">
            还没有账号？{" "}
            <Link href="/register" className="text-pink-500 hover:underline">
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
