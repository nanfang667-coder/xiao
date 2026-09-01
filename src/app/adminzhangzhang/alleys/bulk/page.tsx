import { requireAdmin } from "@/lib/auth";
import { BulkAlleyImport } from "./BulkAlleyImport";

export default async function BulkAlleyPage() {
  await requireAdmin();
  return <BulkAlleyImport />;
}