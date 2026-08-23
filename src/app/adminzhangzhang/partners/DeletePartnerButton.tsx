"use client";

import { deletePartnerLink } from "./actions";

export function DeletePartnerButton({ id, name }: { id: number; name: string }) {
  const action = deletePartnerLink.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm(`确定删除「${name}」吗？此操作不可恢复。`)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 active:bg-red-50">
        删除
      </button>
    </form>
  );
}
