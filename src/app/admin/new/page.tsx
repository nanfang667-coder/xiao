import { requireAdmin } from "@/lib/auth";
import { createTeacher } from "../actions";
import { TeacherForm } from "../TeacherForm";

export default async function NewTeacherPage() {
  await requireAdmin(); // 未登录会被挡下
  return <TeacherForm action={createTeacher} submitLabel="添加老师" />;
}
