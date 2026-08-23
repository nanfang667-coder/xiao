import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getPartnerLinkByIdForAdmin } from "@/lib/partner-links";
import { updatePartnerLink } from "../../actions";
import { PartnerForm } from "../../PartnerForm";

export default async function EditPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const partner = await getPartnerLinkByIdForAdmin(id);
  if (!partner) notFound();

  return (
    <PartnerForm
      action={updatePartnerLink.bind(null, partner.id)}
      initial={partner}
      submitLabel="保存修改"
    />
  );
}
