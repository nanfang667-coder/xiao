import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import type { TeacherPostFields } from "@/lib/teacher-post-input";
import { cleanPartnerImportFields } from "@/lib/partner-import-declarations";
import { readPartnerPhotoCover } from "@/lib/partner-import-photo-cover";
import { DraftForm } from "../../DraftForm";
import { AssignedFinalReview } from "../../FinalReviewPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "审查导入草稿", robots: { index: false, follow: false }, referrer: "no-referrer" };

function readFields(json: string): TeacherPostFields | null {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fields = value as Record<string, unknown>;
    const text = (key: string) => typeof fields[key] === "string" ? fields[key] as string : "";
    return {
      name: text("name"), type: text("type") || "钢琴", city: text("city"), district: text("district"),
      price: text("price"), services: text("services"), courseNotes: text("courseNotes") || null,
      age: text("age") || null, phone: text("phone"), wechat: text("wechat"), qq: text("qq") || null,
      otherContact: text("otherContact") || null, address: text("address") || null,
    };
  } catch { return null; }
}

function readPhotos(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9_-]+\.jpg$/.test(item)) : [];
  } catch { return []; }
}

export default async function PartnerImportDraftPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const assignmentReady = await isPartnerImportAssignmentReady();
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const draft = await prisma.partnerImportDraft.findUnique({
    where: { id: Number(id) },
    select: {
      id: true, status: true, fields: true, photos: true, version: true, baseRevision: true, createdAt: true,
      ...(assignmentReady ? {
        assignedAccount: { select: { username: true } },
        submission: { select: { id: true, reviewNote: true } },
      } : {}),
      post: { select: { revision: true, teacherId: true, source: { select: { name: true } } } },
    },
  });
  if (!draft) notFound();
  let photoCover;
  try { photoCover = readPartnerPhotoCover(draft.fields, !["published", "rejected"].includes(draft.status)); }
  catch {
    return <p role="alert" className="p-4 text-sm text-red-700">图片覆盖设置无法读取，暂时不能审核。请重新导入或检查配置。</p>;
  }
  const storedFields = readFields(draft.fields);
  const fields = storedFields && draft.status === "pending" ? cleanPartnerImportFields(storedFields) : storedFields;
  const formProps = fields ? {
    id: draft.id, version: draft.version, status: draft.status, fields, photos: readPhotos(draft.photos),
    photoCover, postRevision: draft.post.revision, baseRevision: draft.baseRevision,
    teacherId: draft.post.teacherId, reviewNote: assignmentReady ? draft.submission?.reviewNote : undefined,
  } : null;

  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
    <header className="-mx-4 mb-5 flex flex-wrap items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
      <Link href="/adminzhangzhang/partner-import#drafts" className="text-sm text-white/90">← 待审区</Link>
      <h1 className="font-bold">审查草稿 #{draft.id}</h1>
    </header>
    {!assignmentReady && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">团队分配功能尚未启用，当前可继续导入和审核。</p>}
    <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="break-words text-sm text-gray-700">来源：{draft.post.source.name}</p>
      {assignmentReady && draft.assignedAccount && <p className="mt-2 text-sm text-gray-700">负责成员：{draft.assignedAccount.username}</p>}
      <p className="mt-2 text-xs text-gray-500">导入于 {draft.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
      <p className="mt-2 text-xs leading-6 text-gray-500">正文以可编辑纯文本显示；下方照片来自私有副本。请核对资料、联系方式和照片，再确认发布。</p>
    </section>
    {formProps ? assignmentReady && draft.status === "submitted" && draft.submission
      ? <AssignedFinalReview key={`${draft.id}-${draft.version}`} {...formProps} submissionId={draft.submission.id} />
      : <DraftForm key={`${draft.id}-${draft.version}`} {...formProps} />
      : <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">草稿格式无法读取，暂时不能发布。请重新导入或检查配置。</p>}
  </main>;
}