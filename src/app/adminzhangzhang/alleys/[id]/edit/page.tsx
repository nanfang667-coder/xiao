import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getAlleyByIdForAdmin } from "@/lib/alleys";
import { updateAlley } from "../../actions";
import { AlleyForm } from "../../AlleyForm";

export default async function EditAlleyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const alley = await getAlleyByIdForAdmin(id);
  if (!alley) notFound();

  return (
    <AlleyForm
      action={updateAlley.bind(null, alley.id)}
      initial={alley}
      submitLabel="保存修改"
    />
  );
}
