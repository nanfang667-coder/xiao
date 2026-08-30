"use client"; // 有交互（筛选标签页），要在浏览器运行

import { useState } from "react";
import {
  GrantMembershipForm,
  RevokeMembershipButton,
  BanUserButton,
  UnbanUserButton,
  DeleteUserButton,
} from "./UserActions";

// 传给客户端的用户数据（日期已在服务端格式化好，且不含密码等敏感字段）
export type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  referralCode: string;
  referralVisitorCount: number;
  isMember: boolean;
  createdAtLabel: string;
  expiryLabel: string | null; // 仅会员有：「永久会员」或「会员到期：xxxx」
  memberSinceLabel: string | null; // 最近一次成为会员的日期（续费/延期不变）
  isBanned: boolean;
  bannedAtLabel: string | null;
  banReason: string | null;
};

// Site-wide unique visitors: rolling 24 hours / all time / rolling 30 days.
export type SiteVisitorStats = { day: number; total: number; month: number };

type Filter = "all" | "member" | "normal" | "banned";

const HIGH_VISITOR_THRESHOLD = 10;

export function UsersBrowser({
  users,
  siteVisitorStats,
}: {
  users: AdminUser[];
  siteVisitorStats: SiteVisitorStats;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showHighVisitorOnly, setShowHighVisitorOnly] = useState(false);

  const memberCount = users.filter((u) => u.isMember).length;
  const normalCount = users.length - memberCount;
  const bannedCount = users.filter((u) => u.isBanned).length;
  const highVisitorCount = users.filter(
    (u) => u.referralVisitorCount > HIGH_VISITOR_THRESHOLD,
  ).length;

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "全部", count: users.length },
    { key: "member", label: "👑 会员用户", count: memberCount },
    { key: "normal", label: "普通用户", count: normalCount },
    { key: "banned", label: "🚫 已封禁", count: bannedCount },
  ];

  const trimmedSearch = search.trim().toLowerCase();

  const list = users
    .filter((u) => {
      if (filter === "member" && !u.isMember) return false;
      if (filter === "normal" && u.isMember) return false;
      if (filter === "banned" && !u.isBanned) return false;
      if (
        showHighVisitorOnly &&
        u.referralVisitorCount <= HIGH_VISITOR_THRESHOLD
      )
        return false;
      if (
        trimmedSearch &&
        !String(u.id).includes(trimmedSearch) &&
        !u.username.toLowerCase().includes(trimmedSearch) &&
        !u.referralCode.toLowerCase().includes(trimmedSearch) &&
        !(u.email ?? "").toLowerCase().includes(trimmedSearch)
      )
        return false;
      return true;
    })
    .sort((a, b) =>
      showHighVisitorOnly ? b.referralVisitorCount - a.referralVisitorCount : 0,
    );

  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">全站独立访客</h2>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: "近24小时", count: siteVisitorStats.day },
          { label: "近30天", count: siteVisitorStats.month },
          { label: "\u603b\u5171", count: siteVisitorStats.total },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-white p-3 text-center shadow-sm"
          >
            <div className="text-lg font-bold text-pink-500">{s.count}</div>
            <div className="mt-0.5 text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 按用户ID / 用户名 / 邮箱搜索 */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索用户ID / 用户名 / 邮箱 / 邀请码"
        className="mb-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-pink-400"
      />

      {/* 筛选标签页（带数量） */}
      <div className="mb-3 flex gap-2">
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

      {/* 高访客邀请链接快捷筛选；可与用户类型和搜索条件组合使用 */}
      <button
        type="button"
        aria-pressed={showHighVisitorOnly}
        onClick={() => setShowHighVisitorOnly((current) => !current)}
        className={`mb-4 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
          showHighVisitorOnly
            ? "border-pink-500 bg-pink-500 text-white shadow"
            : "border-pink-200 bg-white text-gray-600 shadow-sm"
        }`}
      >
        <span>独立访客 &gt; {HIGH_VISITOR_THRESHOLD}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            showHighVisitorOnly
              ? "bg-white/20 text-white"
              : "bg-pink-50 text-pink-500"
          }`}
        >
          {highVisitorCount} 个链接
          {showHighVisitorOnly ? " · 人数从高到低" : ""}
        </span>
      </button>

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
              {u.isBanned && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                  🚫 已封禁
                </span>
              )}
            </div>

            {/* 第二行：邮箱、注册时间、会员到期 */}
            <div className="mt-1.5 space-y-0.5 text-xs text-gray-400">
              {u.email && <p>📮 {u.email}</p>}
              <p>注册于 {u.createdAtLabel}</p>
              <p className="flex flex-wrap items-center gap-1.5 font-medium text-pink-500">
                <span>🔗 邀请码 {u.referralCode}</span>
                <span className="rounded-full bg-pink-50 px-2 py-0.5">
                  独立访客 <strong>{u.referralVisitorCount}</strong> 人
                </span>
              </p>
              {u.isMember && u.expiryLabel && (
                <p className="text-amber-500">{u.expiryLabel}</p>
              )}
              {u.isMember && u.memberSinceLabel && (
                <p>入会于 {u.memberSinceLabel}</p>
              )}
              {u.isBanned && (
                <p className="text-red-500">
                  封禁于 {u.bannedAtLabel}
                  {u.banReason ? ` · ${u.banReason}` : ""}
                </p>
              )}
            </div>

            {/* 第三行：操作按钮 */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-50 pt-3">
              {u.isMember ? (
                <RevokeMembershipButton id={u.id} username={u.username} />
              ) : (
                <GrantMembershipForm id={u.id} username={u.username} />
              )}
              <div className="flex items-center gap-2">
                {u.isBanned ? (
                  <UnbanUserButton id={u.id} username={u.username} />
                ) : (
                  <BanUserButton id={u.id} username={u.username} />
                )}
                <DeleteUserButton id={u.id} username={u.username} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
