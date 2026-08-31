"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  citiesOfProvince,
  normalizeProvince,
  provinces,
  resolveDistrict,
} from "@/data/locations";
import type { AlleyAdmin } from "@/lib/alleys";

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function getSupportedImages(files: FileList | File[]) {
  return Array.from(files).filter((file) => supportedImageTypes.has(file.type));
}

function appendFiles(current: File[], incoming: File[], limit: number) {
  return [...current, ...incoming].slice(0, limit);
}

export function AlleyForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: AlleyAdmin;
  submitLabel: string;
}) {
  const [city, setCity] = useState(initial?.city ?? "");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [detailFiles, setDetailFiles] = useState<File[]>([]);
  const [coverPreview, setCoverPreview] = useState("");
  const [detailPreviews, setDetailPreviews] = useState<string[]>([]);
  const [coverDragActive, setCoverDragActive] = useState(false);
  const [detailDragActive, setDetailDragActive] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const detailInputRef = useRef<HTMLInputElement>(null);
  const districts = citiesOfProvince(city);
  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400";

  useEffect(() => {
    if (!coverInputRef.current) return;
    const transfer = new DataTransfer();
    if (coverFile) transfer.items.add(coverFile);
    coverInputRef.current.files = transfer.files;
  }, [coverFile]);

  useEffect(() => {
    if (!detailInputRef.current) return;
    const transfer = new DataTransfer();
    detailFiles.forEach((file) => transfer.items.add(file));
    detailInputRef.current.files = transfer.files;
  }, [detailFiles]);

  useEffect(() => {
    if (!coverFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL state follows the selected file.
      setCoverPreview("");
      return;
    }
    const url = URL.createObjectURL(coverFile);

    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  useEffect(() => {
    const urls = detailFiles.map((file) => URL.createObjectURL(file));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs follow the selected files.
    setDetailPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [detailFiles]);

  const selectCoverFiles = (files: FileList | File[]) => {
    const [file] = getSupportedImages(files);
    if (file) setCoverFile(file);
  };

  const selectDetailFiles = (files: FileList | File[]) => {
    const incoming = getSupportedImages(files);
    if (incoming.length === 0) return;
    setDetailFiles((current) => appendFiles(current, incoming, 8));
  };

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/adminzhangzhang/alleys" className="text-pink-500">
          ← 返回
        </Link>
        <h1 className="text-base font-bold text-gray-900">
          {initial ? "编辑暗巷" : "添加暗巷"}
        </h1>
        <span className="w-10" />
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className={label}>标题</label>
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={initial?.title}
            className={field}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className={label}>省份（选填）</label>
            <input
              name="city"
              list="alley-province-options"
              maxLength={40}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              onBlur={(event) => {
                const matched = normalizeProvince(event.target.value);
                if (matched) setCity(matched);
              }}
              className={field}
            />
            <datalist id="alley-province-options">
              {provinces.map((province) => (
                <option key={province} value={province} />
              ))}
            </datalist>
          </div>
          <div className="flex-1">
            <label className={label}>城市／地区（选填）</label>
            <input
              name="district"
              list="alley-district-options"
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
              className={field}
            />
            <datalist id="alley-district-options">
              {districts.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className={label}>详细地址（选填，所有人可见）</label>
          <input
            name="address"
            maxLength={300}
            defaultValue={initial?.address}
            className={field}
          />
        </div>

        <div>
          <label className={label}>详细介绍（仅会员可见）</label>
          <textarea
            name="description"
            required
            maxLength={10000}
            rows={10}
            defaultValue={initial?.description}
            className={field}
          />
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
          <label className={label}>列表封面图（选填，公开，最多 1 张）</label>
          <input
            id="alley-cover-photo"
            ref={coverInputRef}
            type="file"
            name="coverPhoto"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => selectCoverFiles(event.target.files ?? [])}
            className="sr-only"
          />
          <label
            htmlFor="alley-cover-photo"
            onDragEnter={(event) => {
              event.preventDefault();
              setCoverDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setCoverDragActive(true);
            }}
            onDragLeave={() => setCoverDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setCoverDragActive(false);
              selectCoverFiles(event.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
              coverDragActive
                ? "border-blue-400 bg-blue-100"
                : "border-blue-200 bg-white/70 active:bg-blue-100"
            }`}
          >
            <span className="text-sm font-semibold text-blue-600">
              {
                "\u62d6\u62fd 1 \u5f20\u56fe\u7247\u5230\u8fd9\u91cc\uff0c\u6216\u70b9\u51fb\u9009\u62e9"
              }
            </span>
            <span className="mt-1 text-xs text-gray-400">
              {"\u652f\u6301 JPEG\u3001PNG\u3001WebP"}
            </span>
          </label>
          <p className="mt-2 text-xs text-blue-700/70">
            这张图只在暗巷列表展示，不会出现在详情页。
          </p>
          {(coverPreview || initial?.coverPhoto) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverPreview || initial?.coverPhoto}
              alt="列表封面预览"
              className="mt-3 h-36 w-full rounded-xl object-cover"
            />
          )}
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <label className={label}>
            详情图片（选填，仅会员可见，最多 8 张）
          </label>
          <input
            id="alley-detail-photos"
            ref={detailInputRef}
            type="file"
            name="detailPhotos"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => selectDetailFiles(event.target.files ?? [])}
            className="sr-only"
          />
          <label
            htmlFor="alley-detail-photos"
            onDragEnter={(event) => {
              event.preventDefault();
              setDetailDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDetailDragActive(true);
            }}
            onDragLeave={() => setDetailDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDetailDragActive(false);
              selectDetailFiles(event.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
              detailDragActive
                ? "border-amber-400 bg-amber-100"
                : "border-amber-200 bg-white/70 active:bg-amber-100"
            }`}
          >
            <span className="text-sm font-semibold text-amber-700">
              {
                "\u62d6\u62fd\u56fe\u7247\u5230\u8fd9\u91cc\uff0c\u6216\u70b9\u51fb\u9009\u62e9"
              }
            </span>
            <span className="mt-1 text-xs text-gray-400">
              {
                "\u652f\u6301 JPEG\u3001PNG\u3001WebP\uff1b\u6700\u591a 8 \u5f20"
              }
            </span>
            {detailFiles.length > 0 && (
              <span className="mt-2 text-xs font-medium text-amber-700">
                {"\u5df2\u9009\u62e9 "}
                {detailFiles.length}
                {" / 8 \u5f20"}
              </span>
            )}
          </label>
          <p className="mt-2 text-xs text-amber-800/70">
            这组图片不会出现在列表页，普通用户也无法通过图片地址访问。
          </p>
          {(detailPreviews.length > 0 ||
            (initial?.detailPhotos.length ?? 0) > 0) && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(detailPreviews.length > 0
                ? detailPreviews
                : (initial?.detailPhotos ?? [])
              ).map((photo, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={photo}
                  src={photo}
                  alt={`详情图片预览 ${index + 1}`}
                  className="h-24 w-full rounded-lg object-cover"
                />
              ))}
            </div>
          )}
          {initial && (
            <p className="mt-2 text-xs text-gray-500">
              编辑时不选择新图片会保留现有详情图片。
            </p>
          )}
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
          <p className="mt-1 text-xs text-gray-400">数字越小越靠前。</p>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
          <input
            type="checkbox"
            name="isPublished"
            defaultChecked={initial?.isPublished ?? true}
            className="h-4 w-4 accent-pink-500"
          />
          <span className="text-sm text-gray-700">在前台公开展示</span>
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
