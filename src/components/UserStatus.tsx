"use client";

import Link from "next/link";
import { logout } from "@/app/user-actions";

export function UserStatus({ username, isMember }: { username?: string; isMember?: boolean }) {
  if (!username) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="rounded-full bg-white/20 px-3 py-1 text-xs text-white hover:bg-white/30"
        >
          登录
        </Link>
        <Link
          href="/register"
          className="rounded-full bg-white px-3 py-1 text-xs text-pink-500 hover:bg-gray-100"
        >
          注册
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div className="text-xs text-white/90">{username}</div>
        <div className="text-xs text-white/70">
          {isMember ? "💎 会员" : "👤 普通用户"}
        </div>
      </div>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-full bg-white/20 px-3 py-1 text-xs text-white hover:bg-white/30"
        >
          退出
        </button>
      </form>
    </div>
  );
}