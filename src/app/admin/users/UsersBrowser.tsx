"use client"; // 有交互（筛选标签页），要在浏览器运行

import { useState } from "react";
import {
  GrantMembershipForm,
  RevokeMembershipButton,
  DeleteUserButton,
} from "./UserActions";

// 传给客户端的用户数据（日期已在服务端格式化好，且不含密码等敏感字段）
export type AdminUser = {
  id: number;
  username: string;
  email: string;
  isMember: boolean;
  createdAtLabel: string;
  expiryLabel: string | null; // 仅会员有：「永久会员」或「会员到期：xxxx」
};

type Filter = "all" | "member" | "normal";

export function UsersBrowser({ users }: { users: AdminUser[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const memberCount = users.filter((u) => u.isMember).length;
  const normalCount = users.length - memberCount;

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "全部", count: users.length },
    { key: "member", label: "👑 会员用户", count: memberCount },
    { key: "normal", label: "普通用户", count: normalCount },
  ];

  const trimmedSearch = search.trim().toLowerCase();

  const list = users.filter((u) => {
    if (filter === "member" && !u.isMember) return false;
    if (filter === "normal" && u.isMember) return false;
    if (
      trimmedSearch &&
      !String(u.id).includes(trimmedSearch) &&
      !u.username.toLowerCase().includes(trimmedSearch) &&
      !u.email.toLowerCase().includes(trimmedSearch)
    )
      return false;
    return true;
  });

  return (
    <>
      {/* 按用户ID / 用户名 / 邮箱搜索 */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索用户ID / 用户名 / 邮箱"
        className="mb-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-pink-400"
      />

      {/* 筛选标签页（带数量） */}
      <div className="mb-4 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`flex-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
              filter === t.key
                ? "bg-pink-500 text-white shadow"
                : "bg-white text-gray-600 shadow-sm"
            }`}
          >
            {t.label}
            <span
              className={`ml-1 ${
                filter === t.key ? "text-white/90" : "text-pink-500"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* 用户列表 */}
      <div className="space-y-3">
        {list.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            没有符合条件的用户
          </p>
        )}
        {list.map((u) => (
          <div key={u.id} className="rounded-2xl bg-white p-4 shadow-sm">
            {/* 第一行：用户名 + 会员标识 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">#{u.id}</span>
              <h2 className="text-sm font-semibold text-gray-800">
                {u.username}
              </h2>
              {u.isMember ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-600">
                  👑 会员
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  普通用户
                </span>
              )}
            </div>

            {/* 第二行：邮箱、注册时间、会员到期 */}
            <div className="mt-1.5 space-y-0.5 text-xs text-gray-400">
              <p>📮 {u.email}</p>
              <p>注册于 {u.createdAtLabel}</p>
              {u.isMember && u.expiryLabel && (
                <p className="text-amber-500">{u.expiryLabel}</p>
              )}
            </div>

            {/* 第三行：操作按钮 */}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-50 pt-3">
              {u.isMember ? (
                <RevokeMembershipButton id={u.id} username={u.username} />
              ) : (
                <GrantMembershipForm id={u.id} username={u.username} />
              )}
              <DeleteUserButton id={u.id} username={u.username} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
