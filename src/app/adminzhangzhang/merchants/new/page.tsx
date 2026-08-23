import { requireAdmin } from "@/lib/auth";
import { createMerchant } from "../actions";
import { MerchantForm } from "../MerchantForm";

export default async function NewMerchantPage() {
  await requireAdmin();
  return <MerchantForm action={createMerchant} submitLabel="添加商家" />;
}
