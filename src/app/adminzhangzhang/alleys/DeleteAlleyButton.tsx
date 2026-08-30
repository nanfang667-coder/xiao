"use client";

import { deleteAlley } from "./actions";

export function DeleteAlleyButton({
  id,
  title,
}: {
  id: number;
  title: string;
}) {
  const action = deleteAlley.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !confirm(
            `确定删除「${title}」吗？公开封面和会员详情图片也会被删除，此操作不可恢复。`,
          )
        ) {
          event.preventDefault();
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
