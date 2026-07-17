import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getTeacherById } from "@/lib/teachers";
import { updateTeacher } from "../../actions";
import { TeacherForm } from "../../TeacherForm";

export default async function EditTeacherPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const rawReturnTo = Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo;
  const returnTo =
    rawReturnTo === "/admin/teachers" || rawReturnTo?.startsWith("/admin/teachers?")
      ? rawReturnTo
      : "/admin/teachers";
  const teacher = await getTeacherById(id);
  if (!teacher) notFound();

  // 把老师编号"预先绑定"到更新操作上，表单提交时就知道改的是哪一位
  const action = updateTeacher.bind(null, Number(teacher.id), returnTo);

  return (
    <TeacherForm
      action={action}
      initial={teacher}
      submitLabel="保存修改"
    />
  );
}
