import Link from "next/link";
import { requireTeamAccount } from "@/lib/team-auth";
import { TeacherForm } from "@/app/adminzhangzhang/TeacherForm";
import { createTeamTeacherSubmission } from "../../actions";
import { prisma } from "@/lib/prisma";
import {
  getTeamMonthlyPostUsageWhere,
  summarizeTeamPostQuota,
} from "@/lib/team-post-quota";

export default async function NewTeamPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const account = await requireTeamAccount();
  const { error } = await searchParams;
  const monthlyPostUsage = await prisma.teacherSubmission.count({
    where: getTeamMonthlyPostUsageWhere(account.id),
  });
  const quota = summarizeTeamPostQuota(
    account.monthlyPostLimit,
    monthlyPostUsage,
  );

  if (quota.exhausted) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <h1 className="font-bold text-gray-900">本月发帖额度已用完</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            本月已使用 {quota.used}/{quota.limit} 条新帖额度。下月会按北京时间自动恢复；修改已有帖子不受影响。
          </p>
          <Link
            href="/team/posts"
            className="mt-5 inline-block rounded-xl bg-pink-500 px-5 py-2.5 text-sm font-bold text-white"
          >
            返回我的帖子
          </Link>
        </div>
      </main>
    );
  }

  const notice =
    error === "quota"
      ? "本月新帖额度已用完。审核拒绝会释放额度，下月也会自动恢复。"
      : error
        ? "提交失败，请检查标题、服务内容、联系方式和图片后重试。"
        : `本月剩余 ${quota.remaining} 条新帖额度；帖子提交后需要管理员审核。`;

  return (
    <TeacherForm
      action={createTeamTeacherSubmission}
      submitLabel="提交审核"
      title="发布新帖"
      backHref="/team/posts"
      showPromotion={false}
      notice={notice}
    />
  );
}
