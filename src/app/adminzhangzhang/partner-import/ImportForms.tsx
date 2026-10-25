"use client";

import { useActionState, useState } from "react";
import type { ImportActionState } from "@/lib/partner-import-types";
import { DISCUZ_FIRST_POST_PHOTO_SELECTOR } from "@/lib/partner-discuz-image-rules";
import { savePartnerSource } from "./actions";

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
  const [rulesFeedback, setRulesFeedback] = useState<ImportActionState>({});
  function updateValue(name: keyof typeof values, value: string) {
    setValues((previous) => ({ ...previous, [name]: value }));
    if (name === "rules") setRulesFeedback({});
  }
  function currentRules(): Record<string, unknown> | null {
    let current: unknown;
    try { current = JSON.parse(values.rules); }
    catch {
      setRulesFeedback({ error: "当前采集规则不是有效的 JSON，未修改任何配置。请先修正后重试。" });
      return null;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      setRulesFeedback({ error: "当前采集规则必须是 JSON 对象，未修改任何配置。" });
      return null;
    }
    return current as Record<string, unknown>;
  }
  function restoreDefaultPostLinks() {
    const current = currentRules();
    if (!current) return;
    let defaults: unknown;
    try { defaults = JSON.parse(defaultRules); }
    catch {
      setRulesFeedback({ error: "默认帖子链接规则不可用，未修改任何配置。请刷新页面后重试。" });
      return;
    }
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)
      || !("postLinkSelector" in defaults) || typeof defaults.postLinkSelector !== "string" || !defaults.postLinkSelector.trim()) {
      setRulesFeedback({ error: "默认帖子链接规则不可用，未修改任何配置。请刷新页面后重试。" });
      return;
    }
    const rules = JSON.stringify({ ...current, postLinkSelector: defaults.postLinkSelector }, null, 2);
    setValues(previous => ({ ...previous, rules }));
    setRulesFeedback({ message: "已恢复默认帖子链接规则。仅替换链接选择器，请点击保存来源配置后生效。" });
  }
  function applyDiscuzFirstPostPhotos() {
    const current = currentRules();
    if (!current) return;
    const rules = JSON.stringify({ ...current, photoSelector: DISCUZ_FIRST_POST_PHOTO_SELECTOR }, null, 2);
    setValues(previous => ({ ...previous, rules }));
    setRulesFeedback({ message: "已应用 Discuz 首帖图片规则，请点击保存来源配置后生效。" });
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
    <details className="rounded-xl bg-gray-50 p-3" open={Boolean(source)}>
      <summary className="cursor-pointer text-sm font-medium text-gray-700">高级配置：图片域名与采集规则</summary>
      <ImageOriginsField key={source?.imageOrigins ?? ""} initialValue={source?.imageOrigins} />
      <p className="mt-1 text-xs leading-5 text-gray-500">本站图片无需填写。若合作方图片存放在其他域名，请先把图片域名加入这里。</p>
      <label className="mt-3 block text-sm text-gray-700">采集规则（JSON）
        <textarea name="rules" value={values.rules} onChange={(event) => updateValue("rules", event.target.value)} rows={12} maxLength={20_000}
          className={`${inputClass} font-mono text-xs`} spellCheck={false} />
      </label>
      <button type="button" disabled={pending} onClick={restoreDefaultPostLinks}
        className="rounded-lg border border-pink-200 px-3 py-2 text-sm font-medium text-pink-600 disabled:opacity-50">恢复默认帖子链接规则</button>
      <p className="mt-1 text-xs leading-5 text-gray-500">仅替换帖子链接选择器，保留图片、翻页及其他规则；点击保存来源配置后才会生效。</p>
      <button type="button" disabled={pending} onClick={applyDiscuzFirstPostPhotos}
        className="rounded-lg border border-pink-200 px-3 py-2 text-sm font-medium text-pink-600 disabled:opacity-50">应用 Discuz 首帖图片规则</button>
      <p className="mt-1 text-xs leading-5 text-gray-500">只获取首帖正文和附件，适用于帖子区初始隐藏的论坛主题。</p>
      <Feedback state={rulesFeedback} />
      <p className="mt-1 text-xs leading-5 text-gray-500">默认兼容本站帖子模板、单篇文章和 Discuz 论坛的标准列表及首帖图片。若已有自定义帖子链接规则，可恢复默认规则后保存再试。需要获取前三页时，请填写列表第一页；特殊翻页可配置 nextPageSelector（下一页链接选择器）或 pageUrlTemplate（分页地址模板）。单页模式不会自动翻页。</p>
    </details>
    <button disabled={pending} className={buttonClass}>{pending ? "正在保存…" : source ? "保存来源配置" : "添加来源"}</button>
    <Feedback state={state} />
  </form>;
}

export function SourceSettings({ sources, defaultRules, selectedSourceId, onSelectSource }: {
  sources: Source[]; defaultRules: string; selectedSourceId?: string; onSelectSource?: (id: string) => void;
}) {
  const [localSelectedSource, setLocalSelectedSource] = useState("");
  const selectedSource = selectedSourceId ?? localSelectedSource;
  function selectSource(id: string) {
    if (selectedSourceId === undefined) setLocalSelectedSource(id);
    onSelectSource?.(id);
  }
  const source = sources.find((item) => String(item.id) === selectedSource);
  return <details className="rounded-2xl bg-white p-4 shadow-sm" open={sources.length === 0}>
    <summary className="cursor-pointer font-bold text-gray-800">合作网站来源配置</summary>
    <p className="mt-2 text-sm leading-6 text-gray-500">每个网站配置一次，以后只需选择来源并粘贴网址获取图片。</p>
    <label className="mt-4 block text-sm font-medium text-gray-700">配置来源
      <select value={selectedSource} onChange={(event) => selectSource(event.target.value)} className={inputClass}>
        <option value="">添加新来源</option>
        {sources.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.origin}</option>)}
      </select>
    </label>
    <SourceEditor key={selectedSource} source={source} defaultRules={defaultRules} />
  </details>;
}
