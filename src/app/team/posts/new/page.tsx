import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireTeamAccount } from "@/lib/team-auth";
import { TeacherForm } from "@/app/adminzhangzhang/TeacherForm";
import { createTeamTeacherSubmission } from "../../actions";
import { prisma } from "@/lib/prisma";
import {
  getEffectiveTeamPostLimit,
  getTeamPostUsageWhere,
  summarizeTeamPostQuota,
} from "@/lib/team-post-quota";

export default async function NewTeamPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const account = await requireTeamAccount();
  const { error } = await searchParams;
  const postUsage = await prisma.teacherSubmission.count({
    where: getTeamPostUsageWhere(account.id),
  });
  const quota = summarizeTeamPostQuota(
    getEffectiveTeamPostLimit(account),
    postUsage,
  );

  if (quota.exhausted) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <h1 className="font-bold text-gray-900">发帖额度已用完</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            累计已使用 {quota.used}/{quota.limit} 条新帖额度。请联系管理员追加额度；审核拒绝会释放额度。额度不会在月初重置。
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
      ? "提交时发帖额度不足，请联系管理员追加额度。审核拒绝会释放额度；剩余额度跨月保留。"
      : error
        ? "提交失败，请检查标题、服务内容、联系方式和图片后重试。"
        : `剩余 ${quota.remaining} 条新帖额度，跨月保留；总额度仅由管理员追加。帖子提交后需要管理员审核，审核拒绝会释放额度。`;

  return (
    <TeacherForm
      action={createTeamTeacherSubmission.bind(null, randomUUID())}
      submitLabel="提交审核"
      title="发布新帖"
      backHref="/team/posts"
      showPromotion={false}
      notice={notice}
    />
  );
}
