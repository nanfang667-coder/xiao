"use client"; // 需要弹出"确认删除"对话框，要在浏览器运行

import { deleteTeacher } from "./actions";

export function DeleteTeacherButton({
  id,
  name,
}: {
  id: number;
  name: string;
}) {
  const action = deleteTeacher.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`确定删除「${name}」吗？此操作不可恢复。`)) {
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
