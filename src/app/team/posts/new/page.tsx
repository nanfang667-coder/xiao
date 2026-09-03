import { requireTeamAccount } from "@/lib/team-auth";
import { TeacherForm } from "@/app/adminzhangzhang/TeacherForm";
import { createTeamTeacherSubmission } from "../../actions";

export default async function NewTeamPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireTeamAccount();
  const { error } = await searchParams;

  return (
    <TeacherForm
      action={createTeamTeacherSubmission}
      submitLabel="提交审核"
      title="发布新帖"
      backHref="/team/posts"
      showPromotion={false}
      notice={error ? "提交失败，请检查标题、服务内容、联系方式和图片后重试。" : "帖子提交后不会立即出现在前台，需要管理员审核通过。"}
    />
  );
}
