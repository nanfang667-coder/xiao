import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTeamAccount } from "@/lib/team-auth";
import type { Teacher } from "@/lib/teachers";
import { TeacherForm } from "@/app/adminzhangzhang/TeacherForm";
import { updateTeamTeacherSubmission } from "../../../actions";

function parsePhotos(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export default async function EditTeamPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const account = await requireTeamAccount();
  const { id: rawId } = await params;
  const { error } = await searchParams;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const [ownership, pending] = await Promise.all([
    prisma.teacherOwnership.findFirst({
      where: { teacherId: id, teamAccountId: account.id },
      include: { teacher: true },
    }),
    prisma.teacherSubmission.findFirst({
      where: {
        teacherId: id,
        teamAccountId: account.id,
        kind: "update",
        status: "pending",
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (!ownership) notFound();
  const source = pending ?? ownership.teacher;
  const initial: Teacher = {
    id: String(ownership.teacher.id),
    name: source.name,
    type: source.type as Teacher["type"],
    city: source.city,
    district: source.district,
    price: source.price,
    services: source.services,
    courseNotes: source.courseNotes,
    age: source.age,
    photos: parsePhotos(source.photos),
    emoji: source.emoji,
    contact: {
      phone: source.phone,
      wechat: source.wechat,
      qq: source.qq,
      other: source.otherContact,
      address: source.address,
    },
    createdAt: ownership.teacher.createdAt,
    isNationallyPromoted: ownership.teacher.isNationallyPromoted,
    promotionOrder: ownership.teacher.promotionOrder,
    promotionStartsAt: ownership.teacher.promotionStartsAt,
    promotionEndsAt: ownership.teacher.promotionEndsAt,
  };

  return (
    <TeacherForm
      action={updateTeamTeacherSubmission.bind(null, id)}
      initial={initial}
      submitLabel="提交修改审核"
      title="修改我的帖子"
      backHref="/team/posts"
      showPromotion={false}
      notice={error ? "提交失败，请检查填写内容和图片后重试。" : pending ? "正在编辑待审核版本；线上仍展示上一次审核通过的内容。" : "修改提交后需要管理员审核；审核前线上原帖不变。"}
    />
  );
}
