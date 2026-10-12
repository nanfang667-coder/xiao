"use client";

import Link from "next/link";
import { provinces, citiesOfProvince, normalizeProvince, resolveDistrict } from "@/data/locations";
import { useActionState, useEffect, useState } from "react";
import type { ImportActionState } from "@/lib/partner-import-types";
import type { TeacherPostFields } from "@/lib/teacher-post-input";
import { DEFAULT_PARTNER_PHOTO_COVER, parsePartnerPhotoCover, type PartnerPhotoCover } from "@/lib/partner-import-photo-cover";
import { reviewPartnerDraft } from "./actions";

type ReviewState = ImportActionState & { reviewComplete?: boolean };
const inputClass = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:bg-gray-50";
const smallFields = [
  ["price", "价格", 100], ["age", "年龄", 50],
  ["phone", "电话", 100], ["wechat", "微信", 100], ["qq", "QQ", 100], ["otherContact", "其他联系方式", 300],
] as const;

export type DraftFormProps = {
  id: number; version: number; status: string; fields: TeacherPostFields; photos: string[];
  postRevision: number; baseRevision: number; teacherId: number | null; photoCover?: PartnerPhotoCover | null;
  mode?: "admin" | "team"; reviewNote?: string | null;
  onReview?: (id: number, version: number, previous: ImportActionState, form: FormData) => Promise<ImportActionState>;
  onPreviewReadyChange?: (ready: boolean) => void;
};

export function DraftForm({ id, version, status, fields, photos, postRevision, baseRevision, teacherId, photoCover, mode = "admin", onReview, reviewNote, onPreviewReadyChange }: DraftFormProps) {
  const isTeam = mode === "team";
  const initialCover = photoCover === undefined && (status === "pending" || isTeam && status !== "published") ? DEFAULT_PARTNER_PHOTO_COVER : photoCover ?? null;
  const [editedFields, setEditedFields] = useState(fields);
  const districts = citiesOfProvince(editedFields.city);
  const provinceOptionsId = `draft-${mode}-${id}-provinces`;
  const districtOptionsId = `draft-${mode}-${id}-districts`;
  const [selectedPhotos, setSelectedPhotos] = useState(photos);
  function updateField(name: keyof TeacherPostFields, value: string) {
    setEditedFields((previous) => ({ ...previous, [name]: value }));
  }
  const [confirmed, setConfirmed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [coverEnabled, setCoverEnabled] = useState(Boolean(initialCover));
  const [coverSettings, setCoverSettings] = useState<PartnerPhotoCover>(initialCover ?? DEFAULT_PARTNER_PHOTO_COVER);
  const [previewedCover, setPreviewedCover] = useState<PartnerPhotoCover | null>(initialCover);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewLoads, setPreviewLoads] = useState<Record<string, "loaded" | "error">>({});
  const [coverError, setCoverError] = useState("");
  const appliedCover = coverEnabled ? previewedCover : null;
  const coverKey = JSON.stringify(appliedCover);
  const previewKey = `${previewRevision}:${coverKey}`;
  const coverUnapplied = coverEnabled && JSON.stringify(coverSettings) !== coverKey;
  const failedPreviews = selectedPhotos.filter((photo) => previewLoads[`${previewKey}:${photo}`] === "error");
  const previewReady = !coverEnabled || (!coverUnapplied && appliedCover !== null &&
    selectedPhotos.every((photo) => previewLoads[`${previewKey}:${photo}`] === "loaded"));
  // Final review also waits for original-image previews when coverage is off.
  const photoPreviewsReady = !coverUnapplied && (!coverEnabled || appliedCover !== null) &&
    selectedPhotos.every((photo) => previewLoads[`${previewKey}:${photo}`] === "loaded");
  useEffect(() => {
    onPreviewReadyChange?.(photoPreviewsReady);
  }, [onPreviewReadyChange, photoPreviewsReady]);
  function resetConfirmation() {
    setConfirmed(false);
    setReplaceConfirmed(false);
  }
  function updateCover<K extends keyof PartnerPhotoCover>(key: K, value: PartnerPhotoCover[K]) {
    setCoverSettings((previous) => ({ ...previous, [key]: value }));
    setCoverError("");
    resetConfirmation();
  }
  function toggleCover(enabled: boolean) {
    setCoverEnabled(enabled);
    setPreviewedCover(null);
    setPreviewLoads({});
    setCoverError("");
    resetConfirmation();
  }
  function previewCover() {
    try {
      const cover = parsePartnerPhotoCover(coverSettings);
      if (!cover) return;
      setCoverSettings(cover);
      setPreviewedCover(cover);
      setPreviewRevision((previous) => previous + 1);
      setPreviewLoads({});
      setCoverError("");
      resetConfirmation();
    } catch {
      setCoverError("请填写有效的网站域名或完整网址，并检查覆盖范围。");
    }
  }
  const [state, action, pending] = useActionState<ReviewState, FormData>(async (previous, formData) => {
    if (isTeam && !onReview) return { ...previous, error: "暂时无法保存，请刷新后重试。" };
    const result = await (onReview ?? reviewPartnerDraft)(id, previous.version ?? version, previous, formData);
    return { ...result, version: result.version ?? previous.version ?? version,
      reviewComplete: previous.reviewComplete || (!result.error && formData.get("intent") !== "save") };
  }, { version });
  const readOnly = (isTeam ? !["assigned", "returned"].includes(status) : status !== "pending") || state.reviewComplete;
  const replacesNewer = baseRevision !== postRevision;
  const publishedId = state.teacherId ?? teacherId;
  const labels: Record<string, string> = { pending: "待初审", ready: "待分配", assigned: "成员处理中", returned: "退回修改", submitted: "待终审", published: "已发布", rejected: "已拒绝" };
  const label = state.reviewComplete ? isTeam ? "已提交审核" : "审核已完成" : labels[status] ?? "待审查";

  return <form action={action} className="space-y-4" onSubmit={(event) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter?.getAttribute("value") !== "reject" && !previewReady) event.preventDefault();
  }}>
    {!isTeam && <input type="hidden" name="photoCover" value={coverKey} />}
    {reviewNote && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">退回说明：{reviewNote}</p>}
    <input type="hidden" name="postRevision" value={postRevision} />
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-gray-800">帖子内容</h2>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">{label}</span>
      </div>
      <fieldset disabled={pending || Boolean(readOnly)} className="space-y-4">
        <input type="hidden" name="type" value={["钢琴", "舞蹈"].includes(editedFields.type) ? editedFields.type : "钢琴"} />
        <label className="block text-sm font-medium text-gray-700">标题 / 名称
          <input name="name" value={editedFields.name} onChange={(event) => updateField("name", event.target.value)} maxLength={100} required className={inputClass} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">省份（选填）
            <input name="city" list={provinceOptionsId} value={editedFields.city ?? ""}
              onChange={(event) => updateField("city", event.target.value)}
              onBlur={(event) => {
                const matched = normalizeProvince(event.target.value);
                if (matched) updateField("city", matched);
              }}
              placeholder="可直接粘贴，如：上海市" maxLength={50} className={inputClass} autoComplete="off" />
            <datalist id={provinceOptionsId}>
              {provinces.map((province) => <option key={province} value={province} />)}
            </datalist>
          </label>
          <label className="block text-sm font-medium text-gray-700">城市（选填）
            <input name="district" list={districtOptionsId} value={editedFields.district ?? ""}
              onChange={(event) => updateField("district", event.target.value)}
              onBlur={(event) => {
                const resolved = resolveDistrict(event.target.value);
                if (resolved) setEditedFields((previous) => ({ ...previous, city: resolved.province, district: resolved.district }));
              }}
              placeholder="可直接粘贴，如：徐汇区" maxLength={50} className={inputClass} autoComplete="off" />
            <datalist id={districtOptionsId}>
              {districts.map((district) => <option key={district} value={district} />)}
            </datalist>
          </label>
          {smallFields.map(([name, title, maxLength]) => <label key={name} className="block text-sm font-medium text-gray-700">{title}
            <input name={name} value={editedFields[name] ?? ""} onChange={(event) => updateField(name, event.target.value)} maxLength={maxLength} className={inputClass} autoComplete="off" />
          </label>)}
        </div>
        <p className="text-xs leading-5 text-gray-500">{isTeam ? "价格、地址及联系方式请手动填写。可以先保存草稿，提交审核前至少填写一种联系方式。" : "价格、地址及电话、微信、QQ、其他联系方式请手动填写。发布前至少填写一种联系方式；可先保存待审，补充后再发布。"}</p>
        <label className="block text-sm font-medium text-gray-700">地址
          <input name="address" value={editedFields.address ?? ""} onChange={(event) => updateField("address", event.target.value)} maxLength={500} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-gray-700">服务内容
          <textarea name="services" value={editedFields.services} onChange={(event) => updateField("services", event.target.value)} required maxLength={4_000} rows={6} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-gray-700">教学案例 / 课程记录
          <textarea name="courseNotes" value={editedFields.courseNotes ?? ""} onChange={(event) => updateField("courseNotes", event.target.value)} maxLength={10_000} rows={8} className={inputClass} />
        </label>
      </fieldset>
    </section>

    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="font-bold text-gray-800">私有照片预览</h2>
      <p className="mt-2 text-xs leading-5 text-gray-500">{isTeam ? "勾选需要保留的照片，保存后取消的照片会移出草稿。照片仅本人和管理员可访问，沿用管理员设置的网址覆盖。" : "勾选需要保留的照片。取消勾选后，保存或发布时会移出此草稿；当前仅管理员可以访问。"}</p>
      {!isTeam && photos.length > 0 && <fieldset disabled={pending || Boolean(readOnly)} className="mt-4 rounded-xl border border-gray-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={coverEnabled} onChange={(event) => toggleCover(event.target.checked)}
            className="accent-pink-500" aria-label="用网站网址覆盖图片水印" />
          用网站网址覆盖图片水印
        </label>
        <p className="mt-2 text-xs leading-5 text-gray-500">同一覆盖设置用于本稿保留的照片。覆盖区域内的内容会被遮住；原图保留，待审时关闭此选项可恢复原图预览。</p>
        {coverEnabled && <div className="mt-3 space-y-3">
          <label className="block text-sm text-gray-700">显示的网址
            <input value={coverSettings.text} maxLength={100} autoComplete="off" aria-label="显示的网址"
              onChange={(event) => updateCover("text", event.target.value)} className={inputClass} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">覆盖位置
              <select value={coverSettings.position} aria-label="覆盖位置" className={inputClass}
                onChange={(event) => updateCover("position", event.target.value as PartnerPhotoCover["position"])}>
                <option value="bottom">底部</option><option value="top">顶部</option>
              </select>
            </label>
            <label className="block text-sm text-gray-700">水平位置
              <select value={coverSettings.align} aria-label="水平位置" className={inputClass}
                onChange={(event) => updateCover("align", event.target.value as PartnerPhotoCover["align"])}>
                <option value="center">居中</option><option value="left">靠左</option><option value="right">靠右</option>
              </select>
            </label>
            <label className="block text-sm text-gray-700">覆盖宽度：{coverSettings.widthPercent}%
              <input type="range" min={25} max={100} step={1} value={coverSettings.widthPercent} aria-label="覆盖宽度"
                onChange={(event) => updateCover("widthPercent", Number(event.target.value))} className="mt-2 block w-full accent-pink-500" />
            </label>
            <label className="block text-sm text-gray-700">覆盖高度：{coverSettings.heightPercent}%
              <input type="range" min={5} max={40} step={1} value={coverSettings.heightPercent} aria-label="覆盖高度"
                onChange={(event) => updateCover("heightPercent", Number(event.target.value))} className="mt-2 block w-full accent-pink-500" />
            </label>
          </div>
          {!readOnly && <button type="button" onClick={previewCover}
            className="rounded-lg border border-pink-200 px-3 py-2 text-sm font-bold text-pink-600">预览覆盖效果</button>}
          {coverError && <p role="alert" className="text-sm text-red-700">{coverError}</p>}
          {!readOnly && <p role={failedPreviews.length ? "alert" : "status"} className={failedPreviews.length ? "text-xs leading-5 text-red-700" : "text-xs leading-5 text-gray-500"}>
            {coverUnapplied ? "设置已更改，请点击“预览覆盖效果”，检查照片后再保存或发布。" :
              failedPreviews.length ? "部分照片预览失败，请重新点击“预览覆盖效果”，或关闭图片覆盖后保存。" :
                previewReady ? "所选照片预览已加载，请确认覆盖位置合适。保存待审不会公开照片。" : "正在加载所选照片的覆盖预览，请稍候…"}
          </p>}
        </div>}
      </fieldset>}
      <fieldset disabled={pending || Boolean(readOnly)} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => <label key={photo} className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          {/* Private images must bypass public Next Image optimization and keep the authenticated route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={`${photo}:${previewKey}`} src={isTeam ? `/team/assigned/${id}/photos/${encodeURIComponent(photo)}` : `/adminzhangzhang/partner-import/photos/${id}/${encodeURIComponent(photo)}?cover=${appliedCover ? encodeURIComponent(coverKey) : "off"}`}
            alt={`待审照片 ${index + 1}`} loading={(coverEnabled || onPreviewReadyChange) && selectedPhotos.includes(photo) ? "eager" : "lazy"}
            onLoad={() => setPreviewLoads((previous) => ({ ...previous, [`${previewKey}:${photo}`]: "loaded" }))}
            onError={() => setPreviewLoads((previous) => ({ ...previous, [`${previewKey}:${photo}`]: "error" }))}
            referrerPolicy="no-referrer" className="aspect-square w-full object-contain" />
          <span className="flex items-center gap-2 p-3 text-sm text-gray-700"><input type="checkbox" name="keepPhotos" value={photo} checked={selectedPhotos.includes(photo)}
            onChange={(event) => {
              setSelectedPhotos((previous) => event.target.checked ? [...previous, photo] : previous.filter((item) => item !== photo));
              resetConfirmation();
            }}
            className="accent-pink-500" />保留照片 {index + 1}</span>
        </label>)}
      </fieldset>
      {photos.length === 0 && <p className="mt-4 text-sm text-gray-500">此草稿没有照片。</p>}
    </section>

    <section className="rounded-2xl bg-white p-4 shadow-sm">
      {!readOnly && isTeam && <fieldset disabled={pending}>
        <h2 className="font-bold text-gray-800">保存和提交</h2>
        <p className="mt-2 text-xs leading-5 text-gray-500">提交后等待管理员终审，审核通过才公开。待终审期间不能修改；被退回后可继续编辑。</p>
        {!previewReady && <p role="status" className="mt-2 text-xs text-amber-700">{failedPreviews.length ? "照片预览加载失败，请刷新页面重试。" : "正在加载照片预览，请稍候…"}</p>}
        <div className="mt-4 flex gap-3">
          <button name="intent" value="save" disabled={!previewReady} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold disabled:opacity-50">保存草稿</button>
          <button name="intent" value="submit" disabled={!previewReady} className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">提交审核</button>
        </div>
        {pending && <p role="status" className="mt-3 text-sm text-gray-500">正在保存，请稍候…</p>}
      </fieldset>}
      {!readOnly && !isTeam && <fieldset disabled={pending}>
        <h2 className="font-bold text-gray-800">审核决定</h2>
        {replacesNewer && <label className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          <input type="checkbox" name="confirmReplace" value="yes" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} className="mt-1.5 accent-pink-500" />
          <span>此原帖已有其他版本发布，发布本稿将替换它。我已核对并确认替换。</span>
        </label>}
        <label className="mt-4 flex items-start gap-2 text-sm leading-6 text-gray-700">
          <input type="checkbox" name="confirmPublish" value="yes" disabled={!previewReady} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1.5 accent-pink-500" />
          <span>我已审查本页内容和所选照片，确认将当前版本公开发布。{teacherId && !replacesNewer ? "发布后会更新此前导入的对应帖子。" : ""}</span>
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button name="intent" value="save" disabled={!previewReady} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50">保存待审</button>
          <button name="intent" value="reject" formNoValidate className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700">拒绝此草稿</button>
          <button name="intent" value="publish" disabled={!previewReady || !confirmed || (replacesNewer && !replaceConfirmed)}
            className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">确认发布</button>
        </div>
        {pending && <p role="status" className="mt-3 text-sm text-gray-500">正在保存审核结果，请稍候…</p>}
      </fieldset>}
      <div aria-live="polite">
        {state.error && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
        {state.message && <p className="mt-3 text-sm text-emerald-700">{state.message}</p>}
      </div>
      {readOnly && <p className="text-sm text-gray-500">{isTeam ? "此版本当前只读。待终审的帖子由管理员审核，退回后可继续修改。" : ["ready", "assigned", "returned", "submitted"].includes(status) ? "此草稿已进入团队处理流程；成员提交后由管理员终审。" : "此草稿的审核已结束。已发布内容可在老师管理中继续编辑。"}</p>}
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link href={isTeam ? "/team/assigned" : "/adminzhangzhang/partner-import#drafts"} className="text-pink-600">{isTeam ? "返回分配列表" : "返回待审区"}</Link>
        {!isTeam && readOnly && publishedId && <Link href={`/adminzhangzhang/${publishedId}/edit`} className="text-pink-600">管理已发布帖子 →</Link>}
      </div>
    </section>
  </form>;
}