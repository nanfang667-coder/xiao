import Link from "next/link";
import type { AdminPartnerLink } from "@/lib/partner-links";

export function PartnerForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: AdminPartnerLink;
  submitLabel: string;
}) {
  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400";

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/adminzhangzhang/partners" className="text-pink-500">
          ← 返回
        </Link>
        <h1 className="text-base font-bold text-gray-900">
          {initial ? "编辑合作伙伴" : "添加合作伙伴"}
        </h1>
        <span className="w-10" />
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className={label}>合作伙伴名称</label>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={initial?.name}
            placeholder="例如：某某生活网"
            className={field}
          />
        </div>

        <div>
          <label className={label}>网站地址</label>
          <input
            type="url"
            inputMode="url"
            name="url"
            required
            maxLength={500}
            defaultValue={initial?.url}
            placeholder="https://example.com"
            className={field}
          />
        </div>

        <div>
          <label className={label}>一句话简介</label>
          <input
            name="description"
            maxLength={120}
            defaultValue={initial?.description ?? ""}
            placeholder="例如：本地生活信息"
            className={field}
          />
        </div>

        <div>
          <label className={label}>链接类型</label>
          <select name="linkType" defaultValue={initial?.linkType ?? "exchange"} className={field}>
            <option value="exchange">友情链接（双方互相挂链接）</option>
            <option value="sponsored">付费推广链接</option>
          </select>
          <p className="mt-1 text-xs text-gray-400">付费推广会自动标记为赞助链接，普通互换请选择友情链接。</p>
        </div>

        <div>
          <label className={label}>排序</label>
          <input
            type="number"
            name="sortOrder"
            min={1}
            max={9999}
            defaultValue={initial?.sortOrder ?? 100}
            className={field}
          />
          <p className="mt-1 text-xs text-gray-400">数字越小越靠前，例如 1 排第一；默认 100。</p>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
          <input
            type="checkbox"
            name="isPublished"
            defaultChecked={initial?.isPublished ?? true}
            className="h-4 w-4 accent-pink-500"
          />
          <span className="text-sm text-gray-700">在首页公开展示</span>
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600"
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
