"use client"; // 表单有交互（省市联动、选文件、预览），要在浏览器运行

import { useState } from "react";
import Link from "next/link";
import { provinces, citiesOfProvince } from "@/data/locations";
import { isImage } from "@/lib/photo";
import type { Alley } from "@/lib/alleys";

// 添加和编辑小巷子信息共用这个表单。
export function AlleyForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: Alley;
  submitLabel: string;
}) {
  const [city, setCity] = useState(initial?.city ?? "上海市");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const districts = citiesOfProvince(city);

  // 选中的新照片的预览地址
  const [previews, setPreviews] = useState<string[]>([]);
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  };

  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400";

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/admin/alleys" className="text-pink-500">
          ← 返回
        </Link>
        <h1 className="text-base font-bold text-gray-900">
          {initial ? "编辑小巷子信息" : "添加小巷子信息"}
        </h1>
        <span className="w-10" />
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className={label}>标题</label>
          <input name="title" required defaultValue={initial?.title} className={field} />
        </div>

        <div>
          <label className={label}>介绍</label>
          <textarea name="intro" required defaultValue={initial?.intro} rows={4} className={field} />
        </div>

        <div>
          <label className={label}>价格</label>
          <input name="price" required defaultValue={initial?.price} className={field} />
        </div>

        <p className="-mb-1 text-xs text-gray-400">省份 / 城市仅用于前台筛选，不会展示给用户</p>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={label}>
              省份 <span className="text-red-500">*</span>
            </label>
            <select
              name="city"
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setDistrict(""); // 换省份时清空已选的城市
              }}
              className={field}
            >
              {provinces.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={label}>
              城市 <span className="text-red-500">*</span>
            </label>
            <select
              name="district"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              required
              className={field}
            >
              <option value="" disabled>
                请选择
              </option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={label}>
            具体位置 <span className="text-red-500">*</span>{" "}
            <span className="text-xs text-gray-400">(会员可见，精确到街道)</span>
          </label>
          <input
            name="location"
            required
            defaultValue={initial?.location}
            placeholder="如：广州市天河区体育西路XX号XX街"
            className={field}
          />
        </div>

        <div>
          <label className={label}>照片（可多选）</label>
          <input
            type="file"
            name="photos"
            accept="image/*"
            multiple
            onChange={handleFiles}
            className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-pink-50 file:px-3 file:py-2 file:text-pink-500"
          />

          {/* 新选择的照片预览 */}
          {previews.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {previews.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="h-24 w-full rounded-lg object-cover"
                />
              ))}
            </div>
          )}

          {/* 编辑时，若没选新图，显示当前照片 */}
          {previews.length === 0 && initial && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-gray-400">当前照片（不选新图就保留）：</p>
              <div className="grid grid-cols-3 gap-2">
                {initial.photos.map((p, i) =>
                  isImage(p) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={p}
                      alt=""
                      className="h-24 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div
                      key={i}
                      className={`flex h-24 w-full items-center justify-center rounded-lg bg-gradient-to-br text-3xl ${p}`}
                    >
                      🏠
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>

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
