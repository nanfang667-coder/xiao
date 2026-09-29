"use client"; // 表单有交互（城市联动、选文件、预览），要在浏览器运行

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { provinces, citiesOfProvince, normalizeProvince, resolveDistrict } from "@/data/locations";
import { isImage } from "@/lib/photo";
import type { Teacher } from "@/lib/teachers";
import { withSelectedPostPhotos } from "@/lib/post-photo-selection";
import styles from "./TeacherForm.module.css";

function SubmitPostButton({ compressing, label }: { compressing: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={compressing || pending} aria-busy={pending}
      className={styles.submitButton}>
      {pending ? "提交中，请稍候…" : compressing ? "图片压缩中..." : label}
    </button>
  );
}
function toChinaDateTimeLocal(value: Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replace(" ", "T");
}


// 添加和编辑共用这个表单。
// action：提交时调用的服务器操作；initial：编辑时传入原有数据；submitLabel：按钮文字。
export function TeacherForm({
  action,
  initial,
  submitLabel,
  backHref = "/adminzhangzhang/teachers",
  title,
  showPromotion = true,
  notice,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: Teacher;
  submitLabel: string;
  backHref?: string;
  title?: string;
  showPromotion?: boolean;
  notice?: string;
}) {
  const [city, setCity] = useState(initial?.city ?? "");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const districts = citiesOfProvince(city);

  // 已选中的照片文件（累加，不会因为再选/再拖一次就把之前的顶掉）
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const compressingRef = useRef(false);

  // 每次累加的文件变化时，重新生成预览图地址，并在下次变化前回收旧的
  useEffect(() => {
    const urls = photoFiles.map((f) => URL.createObjectURL(f));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs must be replaced and revoked with the file selection.
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photoFiles]);

  // 直接提交预览中的完整照片列表，兼容不支持 DataTransfer 构造器的浏览器。
  async function submitPost(formData: FormData) {
    await action(withSelectedPostPhotos(formData, photoFiles));
  }

  // 手机原图动辄几MB到十几MB，多选/多次拖拽累加后很容易超过服务器单次请求大小上限，
  // 导致提交时连接被直接断开（浏览器表现为"网页无法打开"，而不是清晰的报错提示）。
  // 这里在加入队列前先压缩，避免这个问题，同时后台列表加载也更快。
  async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith("image/")) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1600;
      let { width, height } = bitmap;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.8)
      );
      if (!blob) return file;
      const name = file.name.replace(/\.\w+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    } catch {
      return file; // 压缩失败（比如浏览器不支持该图片格式）就用原图，不影响上传
    }
  }

  // 无论是点击选文件，还是把一批文件一起拖进拖拽区，都走这里——追加而不是替换
  const processFiles = async (files: File[]) => {
    if (files.length === 0 || compressingRef.current) return;
    compressingRef.current = true;
    setCompressing(true);
    try {
      const compressed = await Promise.all(files.map(compressImage));
      setPhotoFiles((prev) => [...prev, ...compressed]);
    } finally {
      compressingRef.current = false;
      setCompressing(false);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void processFiles(files);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(false);
    void processFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // 第一张会作为列表/详情页的封面图，所以要能调整顺序
  const movePhoto = (index: number, direction: -1 | 1) => {
    setPhotoFiles((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const label = styles.label;
  const field = styles.field;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href={backHref} className={styles.backLink}>
          ← 返回
        </Link>
        <h1 className={styles.title}>
          {title ?? (initial ? "编辑老师" : "添加老师")}
        </h1>
        <span className={styles.headerSpacer} />
      </div>

      {notice && (
        <p className={styles.notice}>
          {notice}
        </p>
      )}

      <form action={submitPost} className={styles.form}>
        <div>
          <label htmlFor="post-name" className={label}>标题</label>
          <input id="post-name" name="name" required maxLength={100} defaultValue={initial?.name} className={field} />
        </div>

        <div className={styles.columns}>
          <div className={styles.column}>
            <label htmlFor="post-city" className={label}>省份（选填）</label>
            <input
              id="post-city" name="city"
              list="province-options"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={(e) => {
                // 漏写"省/市/自治区"后缀时自动补全，确保跟筛选用的列表对得上
                const matched = normalizeProvince(e.target.value);
                if (matched) setCity(matched);
              }}
              placeholder="可直接粘贴，如：上海市"
              className={field}
            />
            <datalist id="province-options">
              {provinces.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className={styles.column}>
            <label htmlFor="post-district" className={label}>城市（选填）</label>
            <input
              id="post-district" name="district"
              list="district-options"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              onBlur={(e) => {
                // 粘贴/输完区县名后，自动带出它属于哪个省份，并补全漏写的"市/区"等后缀
                // （否则存的是"深圳"、筛选列表里是"深圳市"，前台按城市搜索会搜不到）
                const resolved = resolveDistrict(e.target.value);
                if (resolved) {
                  setCity(resolved.province);
                  setDistrict(resolved.district);
                }
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
          <label htmlFor="post-price" className={label}>价格</label>
          <input id="post-price" name="price" defaultValue={initial?.price} className={field} />
        </div>

        <div>
          <label htmlFor="post-age" className={label}>年龄</label>
          <input
            id="post-age" name="age"
            defaultValue={initial?.age ?? ""}
            placeholder="例如：28 或 25-30"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="post-services" className={label}>服务内容</label>
          <textarea id="post-services" name="services" required maxLength={4000} defaultValue={initial?.services} rows={1} className={field} />
        </div>

        <div>
          <label htmlFor="post-courseNotes" className={label}>教学案例 / 课程记录</label>
          <textarea
            id="post-courseNotes" name="courseNotes"
            defaultValue={initial?.courseNotes ?? ""}
            rows={4}
            placeholder="例如：学员上课频率、教材进度、阶段性成果等"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="post-phone" className={label}>联系电话</label>
          <input id="post-phone" name="phone" defaultValue={initial?.contact.phone} className={field} />
        </div>

        <div>
          <label htmlFor="post-wechat" className={label}>微信号</label>
          <input id="post-wechat" name="wechat" defaultValue={initial?.contact.wechat} className={field} />
          {!showPromotion && <p className={styles.hint}>电话、微信、QQ 或其他联系方式至少填写一项</p>}
        </div>

        <div>
          <label htmlFor="post-qq" className={label}>QQ</label>
          <input id="post-qq" name="qq" defaultValue={initial?.contact.qq ?? ""} className={field} />
        </div>

        <div>
          <label htmlFor="post-otherContact" className={label}>其他联系方式</label>
          <input
            id="post-otherContact" name="otherContact"
            defaultValue={initial?.contact.other ?? ""}
            placeholder="例如：邮箱、Telegram，选填"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="post-address" className={label}>详细地址</label>
          <input
            id="post-address" name="address"
            defaultValue={initial?.contact.address ?? ""}
            placeholder="例如：XX路XX号，帮学员判断通勤距离，选填"
            className={field}
          />
        </div>
        {showPromotion && <fieldset className={styles.promotion}>
          <legend className={styles.legend}>{"\u5168\u56fd\u63a8\u5e7f"}</legend>
          <label htmlFor="post-promotion" className={styles.promotionToggle}>
            <input
              type="checkbox"
              id="post-promotion"
              name="isNationallyPromoted"
              defaultChecked={initial?.isNationallyPromoted ?? false}
              className={styles.checkbox}
            />
            <span>
              <span className={styles.promotionTitle}>{"\u5728\u5168\u56fd\u63a8\u5e7f\u4f4d\u5c55\u793a"}</span>
              <span className={styles.promotionDescription}>
                {"\u5f00\u542f\u540e\u4f1a\u51fa\u73b0\u5728\u9996\u9875\u548c\u6240\u6709\u5730\u533a\u9875\u9876\u90e8\uff0c\u5e76\u6e05\u695a\u6807\u6ce8\u4e3a\u63a8\u5e7f\u5185\u5bb9\u3002"}
              </span>
            </span>
          </label>

          <div className={styles.promotionField}>
            <label htmlFor="promotionOrder" className={label}>{"\u5e7f\u544a\u6392\u5e8f"}</label>
            <input
              id="promotionOrder"
              type="number"
              name="promotionOrder"
              min="1"
              max="9999"
              defaultValue={initial?.promotionOrder ?? 100}
              className={field}
            />
            <p className={styles.promotionHint}>{"\u6570\u5b57\u8d8a\u5c0f\u8d8a\u9760\u524d\uff0c\u4f8b\u5982 1 \u6392\u7b2c\u4e00\u30012 \u6392\u7b2c\u4e8c\uff1b\u672a\u586b\u5199\u9ed8\u8ba4 100\u3002"}</p>
          </div>

          <div className={styles.promotionColumns}>
            <div>
              <label htmlFor="promotionStartsAt" className={label}>{"\u5f00\u59cb\u65f6\u95f4"}</label>
              <input
                id="promotionStartsAt"
                type="datetime-local"
                name="promotionStartsAt"
                defaultValue={toChinaDateTimeLocal(initial?.promotionStartsAt)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="promotionEndsAt" className={label}>{"\u7ed3\u675f\u65f6\u95f4"}</label>
              <input
                id="promotionEndsAt"
                type="datetime-local"
                name="promotionEndsAt"
                defaultValue={toChinaDateTimeLocal(initial?.promotionEndsAt)}
                className={field}
              />
            </div>
          </div>
          <p className={styles.promotionFootnote}>
            {"\u65f6\u95f4\u7559\u7a7a\u8868\u793a\u7acb\u5373\u5f00\u59cb\u6216\u957f\u671f\u5c55\u793a\uff08\u5317\u4eac\u65f6\u95f4\uff09\u3002"}
          </p>
        </fieldset>}


        <div>
          <label htmlFor="post-photos" className={label}>
            照片（可多选，也可以一次拖拽好几张进来）
            {compressing && <span className={styles.compressionStatus}>压缩中...</span>}
          </label>
          <input
            id="post-photos"
            type="file"
            name="photos"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={compressing}
            onChange={handleFiles}
            className={styles.fileInput}
          />
          <label
            htmlFor="post-photos"
            aria-disabled={compressing}
            onDragOver={(e) => {
              e.preventDefault();
              if (!compressingRef.current) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`${styles.uploadZone}${dragActive ? ` ${styles.uploadActive}` : ""}${compressing ? ` ${styles.uploadDisabled}` : ""}`}
          >
            <span className={styles.uploadTitle}>点击选择照片</span>
            <span className={styles.hint}>
              支持 JPEG、PNG、WebP；最多 8 张，单张不超过 5MB
            </span>
          </label>

          {/* 新选择的照片预览：左上角是顺序号，第1张会作为封面图；
              可点右上角 × 移除，或用左右箭头调整这张图排第几 */}
          {previews.length > 0 && (
            <div className={styles.photoGrid}>
              {previews.map((src, i) => (
                <div key={i} className={styles.photoCard}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className={styles.photoImage}
                  />
                  <span className={styles.photoNumber}>
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label={`移除第 ${i + 1} 张照片`}
                    className={styles.removePhoto}
                  >
                    ×
                  </button>
                  <div className={styles.photoControls}>
                    <button
                      type="button"
                      onClick={() => movePhoto(i, -1)}
                      disabled={i === 0}
                      aria-label={`将第 ${i + 1} 张照片前移`}
                      className={styles.movePhoto}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(i, 1)}
                      disabled={i === previews.length - 1}
                      aria-label={`将第 ${i + 1} 张照片后移`}
                      className={styles.movePhoto}
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 编辑时，若没选新图，显示当前照片 */}
          {previews.length === 0 && initial && (
            <div className={styles.existingPhotos}>
              <p className={styles.existingPhotoHint}>当前照片（不选新图就保留）：</p>
              <div className={styles.photoGrid}>
                {initial.photos.map((p, i) =>
                  isImage(p) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={p}
                      alt=""
                      className={`${styles.photoImage} ${styles.existingPhoto}`}
                    />
                  ) : (
                    <div
                      key={i}
                      className={`${styles.photoImage} ${styles.existingPhoto} ${styles.photoPlaceholder}`}
                    >
                      {initial.emoji}
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        <SubmitPostButton compressing={compressing} label={submitLabel} />
      </form>
    </div>
  );
}
