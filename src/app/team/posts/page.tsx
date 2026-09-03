import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeamAccount } from "@/lib/team-auth";
import { isImage } from "@/lib/photo";
import {
  getTeamMonthlyPostUsageWhere,
  summarizeTeamPostQuota,
} from "@/lib/team-post-quota";

function firstPhoto(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
}

function statusLabel(status: string): string {
  if (status === "pending") return "待审核";
  if (status === "rejected") return "未通过";
  return "已通过";
}

export default async function TeamPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const account = await requireTeamAccount();
  const { submitted } = await searchParams;
  const [ownerships, submissions, monthlyPostUsage] = await Promise.all([
    prisma.teacherOwnership.findMany({
      where: { teamAccountId: account.id },
      include: { teacher: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teacherSubmission.findMany({
      where: {
        teamAccountId: account.id,
        status: { in: ["pending", "rejected"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.teacherSubmission.count({
      where: getTeamMonthlyPostUsageWhere(account.id),
    }),
  ]);
  const quota = summarizeTeamPostQuota(
    account.monthlyPostLimit,
    monthlyPostUsage,
  );
  const pendingUpdates = new Set(
    submissions
      .filter((submission) => submission.status === "pending" && submission.kind === "update")
      .map((submission) => submission.teacherId),
  );
  const rejectedUpdates = new Map<number, string | null>();
  for (const submission of submissions) {
    if (
      submission.status === "rejected" &&
      submission.kind === "update" &&
      submission.teacherId &&
      !rejectedUpdates.has(submission.teacherId)
    ) {
      rejectedUpdates.set(submission.teacherId, submission.reviewNote);
    }
  }
  const newSubmissions = submissions.filter((submission) => submission.kind === "create");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center justify-between bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <Link href="/team" className="text-sm text-white/90">← 返回</Link>
        <h1 className="font-bold">我的帖子</h1>
        {quota.exhausted ? (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">额度已满</span>
        ) : (
          <Link href="/team/posts/new" className="rounded-full bg-white/20 px-3 py-1 text-xs">＋ 发帖</Link>
        )}
      </header>

      <p className="mb-4 rounded-xl bg-pink-50 px-4 py-3 text-sm text-pink-700">
        本月新帖：已用 {quota.used}/{quota.limit} 条，剩余 {quota.remaining} 条。修改帖子不占额度。
      </p>

      {submitted && (
        <p className="mb-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">已提交管理员审核。</p>
      )}

      <section className="space-y-3">
        {ownerships.length === 0 && newSubmissions.length === 0 && (
          <p className="py-14 text-center text-sm text-gray-400">还没有发布或待审核的帖子</p>
        )}
        {ownerships.map(({ teacher }) => {
          const photo = firstPhoto(teacher.photos);
          return (
            <article key={teacher.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
              {photo && isImage(photo) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" className="h-14 w-14 rounded-lg object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-pink-50 text-2xl">{teacher.emoji}</div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold text-gray-800">{teacher.name}</h2>
                <p className="mt-1 text-xs text-sky-600">浏览 {teacher.viewCount.toLocaleString("zh-CN")} 次</p>
                <p className="mt-1 text-xs text-gray-400">
                  已发布{pendingUpdates.has(teacher.id) ? " · 修改待审核" : rejectedUpdates.has(teacher.id) ? " · 上次修改未通过" : ""}
                </p>
                {rejectedUpdates.get(teacher.id) && (
                  <p className="mt-1 line-clamp-2 text-xs text-red-500">管理员说明：{rejectedUpdates.get(teacher.id)}</p>
                )}
              </div>
              <Link href={`/team/posts/${teacher.id}/edit`} className="rounded-lg border border-pink-200 px-3 py-1.5 text-xs text-pink-600">
                修改
              </Link>
            </article>
          );
        })}
      </section>

      {newSubmissions.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold text-gray-700">尚未发布</h2>
          <div className="space-y-2">
            {newSubmissions.map((submission) => (
              <div key={submission.id} className="rounded-xl bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-gray-800">{submission.name}</p>
                  <span className={submission.status === "pending" ? "text-xs text-amber-600" : "text-xs text-red-500"}>
                    {statusLabel(submission.status)}
                  </span>
                </div>
                {submission.reviewNote && <p className="mt-2 text-xs text-red-500">管理员说明：{submission.reviewNote}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
