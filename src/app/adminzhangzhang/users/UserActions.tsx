"use client"; // 有确认弹窗，要在浏览器运行

import { deleteUser, banUser, unbanUser } from "../actions";

// 封禁用户按钮
export function BanUserButton({ id, username }: { id: number; username: string }) {
  const action = banUser.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`确定封禁「${username}」吗？封禁后将无法登录。`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-600 active:bg-red-50"
      >
        封禁
      </button>
    </form>
  );
}

// 解封用户按钮
export function UnbanUserButton({ id, username }: { id: number; username: string }) {
  const action = unbanUser.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`确定解封「${username}」吗？`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white active:bg-green-600"
      >
        解封
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
