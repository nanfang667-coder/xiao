// 后台：编辑小巷子信息页面

import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAlleyById } from "@/lib/alleys";
import { updateAlley } from "../../../actions";
import { AlleyForm } from "../../../AlleyForm";

export default async function EditAlleyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const alley = await getAlleyById(id);
  if (!alley) notFound();

  const action = updateAlley.bind(null, Number(id));
  return <AlleyForm action={action} initial={alley} submitLabel="保存修改" />;
}
