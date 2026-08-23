import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getMerchantByIdForAdmin } from "@/lib/merchants";
import { updateMerchant } from "../../actions";
import { MerchantForm } from "../../MerchantForm";

export default async function EditMerchantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const merchant = await getMerchantByIdForAdmin(id);
  if (!merchant) notFound();

  return (
    <MerchantForm
      action={updateMerchant.bind(null, merchant.id)}
      initial={merchant}
      submitLabel="保存修改"
    />
  );
}
