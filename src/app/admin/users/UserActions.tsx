"use client"; // 有确认弹窗和天数选择，要在浏览器运行

import { grantMembership, revokeMembership, deleteUser } from "../actions";

// 开通会员按钮：可选择时长（30天/90天/365天/永久）
export function GrantMembershipForm({ id, username }: { id: number; username: string }) {
  const action = grantMembership.bind(null, id);

  return (
    <form action={action} className="flex items-center gap-2">
      <select
        name="days"
        defaultValue="30"
        className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 outline-none"
      >
        <option value="30">30天</option>
        <option value="90">90天</option>
        <option value="365">1年</option>
        <option value="0">永久</option>
      </select>
      <button
        type="submit"
        onClick={(e) => {
          if (!confirm(`确定为「${username}」开通会员吗？`)) {
            e.preventDefault();
          }
        }}
        className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white active:bg-amber-600"
      >
        开通会员
      </button>
    </form>
  );
}

// 取消会员按钮
export function RevokeMembershipButton({ id, username }: { id: number; username: string }) {
  const action = revokeMembership.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`确定取消「${username}」的会员吗？`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-amber-300 px-3 py-1 text-xs text-amber-600 active:bg-amber-50"
      >
        取消会员
      </button>
    </form>
  );
}

// 删除用户按钮
export function DeleteUserButton({ id, username }: { id: number; username: string }) {
  const action = deleteUser.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`确定删除用户「${username}」吗？此操作不可恢复。`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 active:bg-red-50"
      >
        删除
      </button>
    </form>
  );
}
