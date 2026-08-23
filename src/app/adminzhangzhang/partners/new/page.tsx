import { requireAdmin } from "@/lib/auth";
import { createPartnerLink } from "../actions";
import { PartnerForm } from "../PartnerForm";

export default async function NewPartnerPage() {
  await requireAdmin();
  return <PartnerForm action={createPartnerLink} submitLabel="添加合作伙伴" />;
}
