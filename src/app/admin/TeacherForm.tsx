"use client"; // 表单有交互（城市联动、选文件、预览），要在浏览器运行

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { provinces, citiesOfProvince, provinceOfDistrict } from "@/data/locations";
import { isImage } from "@/lib/photo";
import type { Teacher } from "@/lib/teachers";

// 添加和编辑共用这个表单。
// action：提交时调用的服务器操作；initial：编辑时传入原有数据；submitLabel：按钮文字。
export function TeacherForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: Teacher;
  submitLabel: string;
}) {
  const [city, setCity] = useState(initial?.city ?? "上海市");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const districts = citiesOfProvince(city);

  // 已选中的照片文件（累加，不会因为再选/再拖一次就把之前的顶掉）
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次累加的文件变化时，重新生成预览图地址，并在下次变化前回收旧的
  useEffect(() => {
    const urls = photoFiles.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photoFiles]);

  // 把累加后的完整文件列表同步回真正的 <input type="file">，
  // 这样表单提交时读到的才是全部选中的照片，而不是最后一次选/拖的那一张
  useEffect(() => {
    if (!fileInputRef.current) return;
    const dt = new DataTransfer();
    photoFiles.forEach((f) => dt.items.add(f));
    fileInputRef.current.files = dt.files;
  }, [photoFiles]);

  // 无论是点击选择文件，还是把文件拖到这个 input 上，都走这里——追加而不是替换
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setPhotoFiles((prev) => [...prev, ...files]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400";

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/admin/teachers" className="text-pink-500">
          ← 返回
        </Link>
        <h1 className="text-base font-bold text-gray-900">
          {initial ? "编辑老师" : "添加老师"}
        </h1>
        <span className="w-10" />
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className={label}>标题</label>
          <input name="name" defaultValue={initial?.name} className={field} />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className={label}>省份</label>
            <input
              name="city"
              list="province-options"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="可直接粘贴，如：上海市"
              className={field}
            />
            <datalist id="province-options">
              {provinces.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex-1">
            <label className={label}>城市</label>
            <input
              name="district"
              list="district-options"
              required
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              onBlur={(e) => {
                // 粘贴/输完区县名后，自动带出它属于哪个省份
                const matched = provinceOfDistrict(e.target.value.trim());
                if (matched) setCity(matched);
              }}
              placeholder="可直接粘贴，如：徐汇区"
              className={field}
            />
            <datalist id="district-options">
              {districts.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className={label}>价格</label>
          <input name="price" defaultValue={initial?.price} className={field} />
        </div>

        <div>
          <label className={label}>服务内容</label>
          <textarea name="services" defaultValue={initial?.services} rows={4} className={field} />
        </div>

        <div>
          <label className={label}>教学案例 / 课程记录</label>
          <textarea
            name="courseNotes"
            defaultValue={initial?.courseNotes ?? ""}
            rows={4}
            placeholder="例如：学员上课频率、教材进度、阶段性成果等"
            className={field}
          />
        </div>

        <div>
          <label className={label}>联系电话（会员可见）</label>
          <input name="phone" defaultValue={initial?.contact.phone} className={field} />
        </div>

        <div>
          <label className={label}>微信号（会员可见）</label>
          <input name="wechat" defaultValue={initial?.contact.wechat} className={field} />
        </div>

        <div>
          <label className={label}>QQ（会员可见）</label>
          <input name="qq" defaultValue={initial?.contact.qq ?? ""} className={field} />
        </div>

        <div>
          <label className={label}>照片（可多选，也可以多次拖拽累加）</label>
          <input
            ref={fileInputRef}
            type="file"
            name="photos"
            accept="image/*"
            multiple
            onChange={handleFiles}
            className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-pink-50 file:px-3 file:py-2 file:text-pink-500"
          />

          {/* 新选择的照片预览（可点右上角 × 单独移除） */}
          {previews.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="h-24 w-full rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                  >
                    ×
                  </button>
                </div>
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
                      {initial.emoji}
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
