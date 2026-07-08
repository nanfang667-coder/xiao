// 后台：添加小巷子信息页面

import { requireAdmin } from "@/lib/auth";
import { createAlley } from "../../actions";
import { AlleyForm } from "../../AlleyForm";

export default async function NewAlleyPage() {
  await requireAdmin();
  return <AlleyForm action={createAlley} submitLabel="添加" />;
}
