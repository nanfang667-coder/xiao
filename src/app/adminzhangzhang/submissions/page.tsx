import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isImage } from "@/lib/photo";
import { approveTeacherSubmission, rejectTeacherSubmission } from "./actions";

function firstPhoto(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
}

function allPhotos(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((photo): photo is string => typeof photo === "string" && isImage(photo))
      : [];
  } catch {
    return [];
  }
}

export default async function TeacherSubmissionsPage() {
  await requireAdmin();
  const submissions = await prisma.teacherSubmission.findMany({
    where: { status: "pending" },
    include: {
      account: { select: { username: true } },
      site: { select: { name: true, hostname: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="font-bold">合作帖子审核</h1>
      </header>

      {submissions.length === 0 && (
        <p className="py-16 text-center text-sm text-gray-400">目前没有待审核内容</p>
      )}
      <section className="space-y-4">
        {submissions.map((submission) => {
          const photo = firstPhoto(submission.photos);
          const photos = allPhotos(submission.photos);
          return (
            <article key={submission.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                {photo && isImage(photo) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="h-20 w-20 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-pink-50 text-3xl">{submission.emoji}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      {submission.kind === "create" ? "新帖子" : `修改帖子 #${submission.teacherId}`}
                    </span>
                    <span className="text-xs text-gray-400">发布账号：{submission.account.username}</span>
                  </div>
                  <h2 className="mt-2 font-bold text-gray-800">{submission.name}</h2>
                  <p className="mt-1 text-xs text-gray-500">{submission.city} {submission.district} · {submission.price}</p>
                  <p className="mt-1 text-xs text-gray-400">所属网站：{submission.site.name}（{submission.site.hostname}）</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700">
                <p><span className="text-gray-400">服务内容：</span>{submission.services}</p>
                {submission.courseNotes && <p className="mt-1"><span className="text-gray-400">详细说明：</span>{submission.courseNotes}</p>}
                <p className="mt-1"><span className="text-gray-400">联系方式：</span>{[submission.phone, submission.wechat, submission.qq, submission.otherContact].filter(Boolean).join(" / ")}</p>
                {submission.address && <p className="mt-1"><span className="text-gray-400">地址：</span>{submission.address}</p>}
              </div>
              {photos.length > 1 && (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((src, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${src}-${index}`} src={src} alt="" className="aspect-square w-full rounded-lg object-cover" />
                  ))}
                </div>
              )}
              {submission.kind === "update" && submission.teacherId && (
                <Link href={`/listing/${submission.teacherId}`} target="_blank" className="mt-3 inline-block text-xs text-sky-600">
                  查看当前线上版本 ↗
                </Link>
              )}
              <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                <form action={approveTeacherSubmission.bind(null, submission.id)}>
                  <button className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white">审核通过</button>
                </form>
                <form action={rejectTeacherSubmission.bind(null, submission.id)} className="contents">
                  <input name="reviewNote" maxLength={300} placeholder="未通过说明（选填）" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  <button className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-600">不通过</button>
                </form>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
