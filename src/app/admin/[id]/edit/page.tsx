import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getTeacherById } from "@/lib/teachers";
import { updateTeacher } from "../../actions";
import { TeacherForm } from "../../TeacherForm";

export default async function EditTeacherPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const teacher = await getTeacherById(id);
  if (!teacher) notFound();

  // 把老师编号"预先绑定"到更新操作上，表单提交时就知道改的是哪一位
  const action = updateTeacher.bind(null, Number(teacher.id));

  return <TeacherForm action={action} initial={teacher} submitLabel="保存修改" />;
}
