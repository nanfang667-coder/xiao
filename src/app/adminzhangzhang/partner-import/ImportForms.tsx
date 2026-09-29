"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportActionState } from "@/lib/partner-import-types";
import { allowPartnerImageOrigins, detectPartnerImageOrigins, savePartnerSource, startPartnerImport } from "./actions";

type Source = { id: number; name: string; origin: string; rules: string; imageOrigins: string };
const inputClass = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:bg-gray-50";
const buttonClass = "rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50";

function Feedback({ state }: { state: ImportActionState }) {
  return <div aria-live="polite">
    {state.error && <p className="mt-3 text-sm text-red-700" role="alert">{state.error}</p>}
    {state.message && <p className="mt-3 text-sm text-emerald-700">{state.message}</p>}
  </div>;
}

function originsText(value?: string): string {
  if (!value) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string").join("\n");
  } catch { /* Older configurations can already be newline separated. */ }
  return value;
}

function ImageOriginsField({ initialValue }: { initialValue?: string }) {
  const [value, setValue] = useState(() => originsText(initialValue));
  return <label className="mt-3 block text-sm text-gray-700">额外图片域名（可选，每行一个完整网站地址）
    <textarea name="imageOrigins" value={value} onChange={(event) => setValue(event.target.value)} rows={3} maxLength={4_000}
      className={inputClass} placeholder="https://images.partner.example" autoComplete="off" spellCheck={false} />
  </label>;
}

function SourceEditor({ source, defaultRules }: { source?: Source; defaultRules: string }) {
  const [values, setValues] = useState({ name: source?.name ?? "", origin: source?.origin ?? "",
    rules: source?.rules ?? defaultRules });
  function updateValue(name: keyof typeof values, value: string) {
    setValues((previous) => ({ ...previous, [name]: value }));
  }
  const [state, action, pending] = useActionState(savePartnerSource, {} as ImportActionState);
  return <form action={action} className="mt-4 space-y-3">
    <input type="hidden" name="sourceId" value={source?.id ?? ""} />
    <label className="block text-sm font-medium text-gray-700">来源名称
      <input name="name" value={values.name} onChange={(event) => updateValue("name", event.target.value)} maxLength={80} required className={inputClass} placeholder="例如：合作方网站" />
    </label>
    <label className="block text-sm font-medium text-gray-700">网站地址
      <input name="origin" type="url" value={values.origin} onChange={(event) => updateValue("origin", event.target.value)} readOnly={Boolean(source)} maxLength={300} required
        className={inputClass} placeholder="https://partner.example" autoComplete="off" spellCheck={false} />
    </label>
    {source && <p className="text-xs text-gray-500">更换网站请新建来源；此处可调整名称、图片域名和采集规则。</p>}
    <details className="rounded-xl bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">高级配置：图片域名与采集规则</summary>
      <ImageOriginsField key={source?.imageOrigins ?? ""} initialValue={source?.imageOrigins} />
      <p className="mt-1 text-xs leading-5 text-gray-500">本站图片无需填写。若合作方图片存放在其他域名，请先把图片域名加入这里。</p>
      <label className="mt-3 block text-sm text-gray-700">采集规则（JSON）
        <textarea name="rules" value={values.rules} onChange={(event) => updateValue("rules", event.target.value)} rows={12} maxLength={20_000}
          className={`${inputClass} font-mono text-xs`} spellCheck={false} />
      </label>
      <p className="mt-1 text-xs leading-5 text-gray-500">默认兼容本站帖子模板和单篇文章结构。若字段或图片未匹配，可在此调整采集规则。只提取当前列表页中的帖子，不自动翻页。</p>
    </details>
    <button disabled={pending} className={buttonClass}>{pending ? "正在保存…" : source ? "保存来源配置" : "添加来源"}</button>
    <Feedback state={state} />
  </form>;
}

export function ImportForms({ sources, defaultRules }: { sources: Source[]; defaultRules: string }) {
  const router = useRouter();
  const [selectedSource, setSelectedSource] = useState("");
  const [importSource, setImportSource] = useState("");
  const [listUrl, setListUrl] = useState("");
  const [state, action, pending] = useActionState(startPartnerImport, {} as ImportActionState);
  const [detection, detectAction, detecting] = useActionState(detectPartnerImageOrigins, {} as ImportActionState);
  const [savedOrigins, allowAction, savingOrigins] = useActionState(allowPartnerImageOrigins, {} as ImportActionState);
  const activeSource = importSource || String(sources[0]?.id ?? "");
  const allowedImageOrigins = originsText(sources.find(item => String(item.id) === activeSource)?.imageOrigins).split("\n");
  const imageCheck = detection.imageOriginCheck;
  const currentCheck = imageCheck && String(imageCheck.sourceId) === activeSource && imageCheck.listUrl === listUrl.trim() ? imageCheck : undefined;
  const currentSaved = savedOrigins.imageOriginsSaved && String(savedOrigins.imageOriginsSaved.sourceId) === activeSource
    && savedOrigins.imageOriginsSaved.listUrl === listUrl.trim()
    && Boolean(currentCheck?.origins.every(origin => allowedImageOrigins.includes(origin)));
  const busy = pending || detecting || savingOrigins;
  const source = sources.find((item) => String(item.id) === selectedSource);

  useEffect(() => {
    if (state.jobId) router.push(`/adminzhangzhang/partner-import/jobs/${encodeURIComponent(state.jobId)}`);
  }, [state.jobId, router]);

  return <div className="space-y-4">
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="import-heading">
      <h2 id="import-heading" className="font-bold text-gray-800">导入一个列表页</h2>
      <p className="mt-2 text-sm leading-6 text-gray-500">粘贴第一页或第二页的网址，下载该页列出的帖子及图片。所有内容先进入私有待审区，确认发布后才会出现在网站上。</p>
      {sources.length === 0 ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">先在下方添加一个合作网站来源。</p> : <form action={action} className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-gray-700">选择来源
          <select name="sourceId" required className={inputClass} value={activeSource} disabled={busy} onChange={(event) => setImportSource(event.target.value)}>
            {sources.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.origin}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">列表页网址
          <input name="listUrl" type="url" value={listUrl} readOnly={busy} onChange={(event) => setListUrl(event.target.value)} required maxLength={2_000} className={inputClass}
            placeholder="https://partner.example/posts?page=1" autoComplete="off" spellCheck={false} />
        </label>
        <p className="text-xs leading-5 text-gray-500">只处理你输入的这一页，不跟随下一页。请使用公开可访问的网址；本版不接收登录密码或 Cookie。</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} className={buttonClass}>{pending ? "正在读取这一页…" : "建立导入任务"}</button>
          <button formAction={detectAction} disabled={busy} className="rounded-lg border border-pink-200 px-4 py-2 text-sm font-bold text-pink-600 disabled:opacity-50">{detecting ? "正在检测图片域名…" : "检测图片域名"}</button>
        </div>
        <p className="text-xs leading-5 text-gray-500">照片缺失时可先检测：只抽检本页最多 3 篇帖子的图片地址，不下载图片。新增图片域名经你确认保存后才会用于导入。</p>
        <Feedback state={detection} />
        <Feedback state={state} />
        {state.jobId && <Link href={`/adminzhangzhang/partner-import/jobs/${encodeURIComponent(state.jobId)}`} className="block text-sm text-pink-600">查看导入任务 →</Link>}
      </form>}
      {currentCheck && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-gray-700" aria-live="polite">
        <p>已抽检 {currentCheck.sampled} 篇帖子，识别到 {currentCheck.photoCount} 个图片地址。{currentCheck.failed > 0 && `另有 ${currentCheck.failed} 篇未能完成检测。`}</p>
        <p className="mt-1 text-xs leading-5">抽检结果仅覆盖这几篇帖子；同页其他帖子可能使用更多图片域名。</p>
        {currentCheck.origins.length > 0 ? <>
          <p className="mt-3 font-medium">{currentSaved ? "以下图片域名已保存：" : "以下图片域名尚未获准下载，请核对后保存："}</p>
          <ul className="mt-2 list-inside list-disc break-all">{currentCheck.origins.map(origin => <li key={origin}>{origin}</li>)}</ul>
          <form action={allowAction} className="mt-3">
            <input type="hidden" name="sourceId" value={currentCheck.sourceId} />
            <input type="hidden" name="listUrl" value={currentCheck.listUrl} />
            {currentCheck.origins.map(origin => <input key={origin} type="hidden" name="imageOrigin" value={origin} />)}
            <button name="allowImageOrigins" value="yes" disabled={busy || Boolean(currentSaved)} className={buttonClass}>{savingOrigins ? "正在保存…" : currentSaved ? "这些图片域名已保存" : "允许这些图片域名并保存"}</button>
          </form>
        </> : <p className="mt-2">{currentCheck.photoCount === 0 ? "尚未识别到照片，请检查采集规则。" : "抽检照片使用的图片域名已在允许列表中，可以建立新的导入任务。"}</p>}
        <Feedback state={currentSaved ? savedOrigins : { error: savedOrigins.error }} />
      </div>}
    </section>
    <details className="rounded-2xl bg-white p-4 shadow-sm" open={sources.length === 0}>
      <summary className="cursor-pointer font-bold text-gray-800">合作网站来源配置</summary>
      <p className="mt-2 text-sm leading-6 text-gray-500">每个网站配置一次，以后只需选择来源并粘贴网址。</p>
      <label className="mt-4 block text-sm font-medium text-gray-700">配置来源
        <select value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)} className={inputClass}>
          <option value="">添加新来源</option>
          {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <SourceEditor key={selectedSource} source={source} defaultRules={defaultRules} />
    </details>
  </div>;
}