"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { citiesOfProvince, normalizeProvince, provinces, resolveDistrict } from "@/data/locations";
import type { Merchant } from "@/lib/merchants";
import { isImage } from "@/lib/photo";

export function MerchantForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: Merchant;
  submitLabel: string;
}) {
  const [city, setCity] = useState(initial?.city ?? "");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const districts = citiesOfProvince(city);
  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400";

  useEffect(() => {
    if (!fileInputRef.current) return;
    const transfer = new DataTransfer();
    photoFiles.forEach((file) => transfer.items.add(file));
    fileInputRef.current.files = transfer.files;
  }, [photoFiles]);

  useEffect(() => {
    const urls = photoFiles.map((file) => URL.createObjectURL(file));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs must be replaced and revoked with the file selection.
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [photoFiles]);

  function addPhotoFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    setPhotoFiles((current) => [...current, ...images].slice(0, 8));
  }

  function removePhoto(index: number) {
    setPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotoFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/adminzhangzhang/merchants" className="text-pink-500">
          ← 返回
        </Link>
        <h1 className="text-base font-bold text-gray-900">
          {initial ? "编辑商家" : "添加商家"}
        </h1>
        <span className="w-10" />
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className={label}>商家名称</label>
          <input name="name" required maxLength={80} defaultValue={initial?.name} className={field} />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className={label}>省份</label>
            <input
              name="city"
              list="merchant-province-options"
              maxLength={40}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              onBlur={(event) => {
                const matched = normalizeProvince(event.target.value);
                if (matched) setCity(matched);
              }}
              placeholder="例如：上海市"
              className={field}
            />
            <datalist id="merchant-province-options">
              {provinces.map((province) => <option key={province} value={province} />)}
            </datalist>
          </div>
          <div className="flex-1">
            <label className={label}>城市／地区</label>
            <input
              name="district"
              list="merchant-district-options"
              maxLength={60}
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
              onBlur={(event) => {
                const resolved = resolveDistrict(event.target.value);
                if (resolved) {
                  setCity(resolved.province);
                  setDistrict(resolved.district);
                }
              }}
              placeholder="例如：新宿区"
              className={field}
            />
            <datalist id="merchant-district-options">
              {districts.map((item) => <option key={item} value={item} />)}
            </datalist>
          </div>
        </div>

        <div>
          <label className={label}>详细地址（公开）</label>
          <input name="address" maxLength={300} defaultValue={initial?.address ?? ""} className={field} />
        </div>

        <div>
          <label className={label}>价格</label>
          <input name="price" maxLength={100} defaultValue={initial?.price ?? ""} className={field} />
        </div>

        <div>
          <label className={label}>服务项目</label>
          <textarea name="services" required maxLength={2000} rows={3} defaultValue={initial?.services} className={field} />
        </div>

        <div>
          <label className={label}>商家介绍</label>
          <textarea name="description" maxLength={5000} rows={5} defaultValue={initial?.description ?? ""} className={field} />
        </div>

        <fieldset className="rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
          <legend className="px-1 text-sm font-bold text-gray-800">公开联系方式</legend>
          <div className="space-y-3">
            <input name="phone" maxLength={100} defaultValue={initial?.phone ?? ""} placeholder="电话" className={field} />
            <input name="wechat" maxLength={100} defaultValue={initial?.wechat ?? ""} placeholder="微信" className={field} />
            <input name="qq" maxLength={100} defaultValue={initial?.qq ?? ""} placeholder="QQ" className={field} />
            <input name="otherContact" maxLength={200} defaultValue={initial?.otherContact ?? ""} placeholder="其他联系方式" className={field} />
          </div>
          <p className="mt-2 text-xs text-pink-700/70">以上内容会向所有访客公开。</p>
        </fieldset>

        <div>
          <label className={label}>排序</label>
          <input type="number" name="sortOrder" min={1} max={9999} defaultValue={initial?.sortOrder ?? 100} className={field} />
          <p className="mt-1 text-xs text-gray-400">数字越小越靠前，例如 1 排第一；默认 100。</p>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
          <input type="checkbox" name="isPublished" defaultChecked={initial?.isPublished ?? true} className="h-4 w-4 accent-pink-500" />
          <span className="text-sm text-gray-700">在前台公开展示</span>
        </label>

        <div>
          <label className={label}>照片（可多选，也可以一次拖拽好几张进来）</label>
          <input
            ref={fileInputRef}
            type="file"
            name="photos"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => setPhotoFiles(Array.from(event.target.files ?? []).slice(0, 8))}
            className="hidden"
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addPhotoFiles(Array.from(event.dataTransfer.files ?? []));
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 text-center transition-colors ${
              dragActive
                ? "border-pink-400 bg-pink-50"
                : "border-gray-200 bg-gray-50 active:bg-gray-100"
            }`}
          >
            <span className="text-sm font-medium text-pink-500">点击选择照片</span>
            <span className="mt-1 text-xs text-gray-400">
              支持 JPEG、PNG、WebP；最多 8 张，单张不超过 5MB
            </span>
          </div>
          {photoFiles.length > 0 && (
            <p className="mt-2 text-xs font-medium text-pink-500">已选择 {photoFiles.length} 张照片</p>
          )}
          {previews.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {previews.map((src, index) => (
                <div key={src} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`新选择的商家照片 ${index + 1}`}
                    className="h-24 w-full rounded-lg object-cover"
                  />
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                    aria-label={`移除第 ${index + 1} 张照片`}
                  >
                    ×
                  </button>
                  <div className="absolute bottom-1 left-1 flex gap-1 text-white">
                    <button
                      type="button"
                      onClick={() => movePhoto(index, -1)}
                      disabled={index === 0}
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs disabled:opacity-0"
                      aria-label="向前移动照片"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(index, 1)}
                      disabled={index === previews.length - 1}
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs disabled:opacity-0"
                      aria-label="向后移动照片"
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {previews.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">第 1 张会作为商家列表封面，可用箭头调整顺序。</p>
          )}
          <p className="mt-1 text-xs text-gray-400">总计不超过12MB；编辑时不选新图会保留原图。</p>
          {previews.length === 0 && initial && initial.photos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {initial.photos.map((photo, index) =>
                isImage(photo) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={photo} src={photo} alt={`${initial.name} 当前照片 ${index + 1}`} className="h-24 w-full rounded-lg object-cover" />
                ) : null,
              )}
            </div>
          )}
        </div>

        <button type="submit" className="w-full rounded-lg bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600">
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
