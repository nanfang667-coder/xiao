import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PARTNER_IMPORT_RULES } from "@/lib/partner-import-parser";
import { PartnerImagesWorkspace } from "./PartnerImagesWorkspace";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const metadata: Metadata = { title: "合作网站图片", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PartnerImagesPage() {
  await requireAdmin();
  const sources = await prisma.partnerImportSource.findMany({ orderBy: { name: "asc" },
    select: { id: true, name: true, origin: true, rules: true, imageOrigins: true } });
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-10">
    <header className="-mx-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
      <Link href="/adminzhangzhang" className="text-sm text-white/90">← 后台</Link>
      <h1 className="font-bold">合作网站图片</h1>
    </header>
    <PartnerImagesWorkspace sources={sources} defaultRules={JSON.stringify(DEFAULT_PARTNER_IMPORT_RULES, null, 2)} />
  </main>;
}
