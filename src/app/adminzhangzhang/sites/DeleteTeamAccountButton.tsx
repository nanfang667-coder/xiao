"use client";

import { useFormStatus } from "react-dom";
import { deleteTeamAccount } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-600 disabled:opacity-50">
      {pending ? "删除中…" : "删除账号"}
    </button>
  );
}

export function DeleteTeamAccountButton({ accountId, username }: { accountId: number; username: string }) {
  return (
    <form
      action={deleteTeamAccount.bind(null, accountId)}
      onSubmit={(event) => {
        if (!window.confirm(`确定删除合作账号「${username}」吗？删除后无法登录，投稿及审核记录将被清除；已发布帖子和图片保留，由管理员管理。此操作不可恢复。`)) {
          event.preventDefault();
        }
      }}
    >
      <SubmitButton />
    </form>
  );
}
