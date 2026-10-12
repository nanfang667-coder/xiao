import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeamAccount } from "@/lib/team-auth";
import { prisma } from "@/lib/prisma";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import type { TeacherPostFields } from "@/lib/teacher-post-input";
import { parsePartnerPhotoKeys } from "@/lib/partner-import-photos";
import { readPartnerPhotoCover } from "@/lib/partner-import-photo-cover";
import { DraftForm } from "@/app/adminzhangzhang/partner-import/DraftForm";
import { saveAssignedPartnerDraft } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "完善分配帖子", robots: { index: false, follow: false }, referrer: "no-referrer",
};

function readFields(json: string): TeacherPostFields {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_FIELDS");
  const fields = value as Record<string, unknown>;
  const text = (key: string) => typeof fields[key] === "string" ? fields[key] as string : "";
  return {
    name: text("name"), type: text("type") || "钢琴", city: text("city"), district: text("district"),
    price: text("price"), services: text("services"), courseNotes: text("courseNotes") || null,
    age: text("age") || null, phone: text("phone"), wechat: text("wechat"), qq: text("qq") || null,
    otherContact: text("otherContact") || null, address: text("address") || null,
  };
}

export default async function AssignedImportDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireTeamAccount();
  if (!(await isPartnerImportAssignmentReady())) return <main className="mx-auto w-full max-w-3xl px-4 py-6">
    <Link href="/team" className="text-sm text-pink-600">← 合作后台</Link>
    <p role="status" className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-700">团队分配功能尚未启用，请联系管理员。</p>
  </main>;
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const draft = await prisma.partnerImportDraft.findFirst({
    where: { id: Number(id), teamAccountId: account.id, status: { in: ["assigned", "returned", "submitted", "published"] } },
    select: {
      id: true, status: true, fields: true, photos: true, version: true, baseRevision: true,
      post: { select: { revision: true, teacherId: true } },
      submission: { select: { reviewNote: true } },
    },
  });
  if (!draft) notFound();
  let fields;
  let photos;
  let photoCover;
  try {
    fields = readFields(draft.fields);
    photos = parsePartnerPhotoKeys(draft.photos);
    photoCover = readPartnerPhotoCover(draft.fields, draft.status !== "published");
  } catch {
    return <p role="alert" className="p-4 text-sm text-red-700">帖子资料暂时无法读取，请联系管理员处理。</p>;
  }

  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
    <header className="-mx-4 mb-5 flex flex-wrap items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
      <Link href="/team/assigned" className="text-sm text-white/90">← 分配给我的帖子</Link>
      <h1 className="font-bold">帖子 #{draft.id}</h1>
    </header>
    <p className="mb-4 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-700">
      {["assigned", "returned"].includes(draft.status)
        ? "请核对内容并补充联系方式，可先保存，再提交管理员终审。照片覆盖设置由管理员确定。"
        : draft.status === "submitted" ? "已提交管理员终审，审核期间不能修改。" : "帖子已发布，后续修改请联系管理员。"}
    </p>
    <DraftForm key={`${draft.id}-${draft.version}`} id={draft.id} version={draft.version} status={draft.status}
      mode="team" onReview={saveAssignedPartnerDraft} reviewNote={draft.submission?.reviewNote ?? null}
      fields={fields} photos={photos} photoCover={photoCover} postRevision={draft.post.revision}
      baseRevision={draft.baseRevision} teacherId={draft.post.teacherId} />
  </main>;
}
