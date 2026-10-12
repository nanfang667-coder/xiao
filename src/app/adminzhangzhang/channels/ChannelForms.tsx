"use client";

import { useActionState, useId, useState } from "react";
import {
  createPromotionChannel,
  setPromotionChannelActive,
  updatePromotionChannel,
  type ChannelActionState,
} from "./actions";

const initialState: ChannelActionState = {};
const inputClass = "mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-pink-400";
const buttonClass = "rounded-xl bg-pink-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

function ActionMessage({ state }: { state: ChannelActionState }) {
  return (
    <p aria-live="polite" role={state.error ? "alert" : "status"} className={`text-xs ${state.error ? "text-red-600" : "text-green-700"}`}>
      {state.error || state.success}
    </p>
  );
}

function ChannelDetailsFields({ name = "", hostname = "" }: { name?: string; hostname?: string }) {
  const [nameValue, setName] = useState(name);
  const [hostnameValue, setHostname] = useState(hostname);
  return (
    <>
      <label className="block text-sm text-gray-600">
        渠道名称
        <input name="name" required maxLength={80} value={nameValue} onChange={event => setName(event.target.value)} placeholder="例如：GP77 推广" className={inputClass} />
      </label>
      <label className="block text-sm text-gray-600">
        短链域名
        <input name="hostname" required maxLength={253} value={hostnameValue} onChange={event => setHostname(event.target.value)} placeholder="gp77.top" autoCapitalize="none" spellCheck={false} className={inputClass} />
      </label>
    </>
  );
}

export function CreateChannelForm() {
  const [state, action, pending] = useActionState(createPromotionChannel, initialState);
  const [code, setCode] = useState("");
  return (
    <form action={action} className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-bold text-gray-800">新增推广渠道</h2>
      <fieldset disabled={pending} className="space-y-3">
        <ChannelDetailsFields />
        <label className="block text-sm text-gray-600">
          渠道标识（创建后固定）
          <input name="code" required minLength={2} maxLength={32} value={code} onChange={event => setCode(event.target.value)} placeholder="gp77" autoCapitalize="none" spellCheck={false} className={inputClass} />
        </label>
        <p className="text-xs leading-relaxed text-gray-500">建议直接填写短域名，无需 https:// 或路径。创建后请在短域名服务商处配置重定向，保存这里的信息不会自动配置域名。</p>
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? "创建中…" : "创建渠道"}</button>
        <ActionMessage state={state} />
      </fieldset>
    </form>
  );
}

export function ChannelTarget({ url }: { url: string }) {
  const inputId = useId();
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("已复制重定向地址");
    } catch {
      setMessage("自动复制失败，请选中地址手动复制");
    }
  }
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <label htmlFor={inputId} className="text-xs text-gray-500">将短域名重定向到此地址</label>
      <div className="mt-1 flex items-center gap-2">
        <input id={inputId} readOnly value={url} onFocus={event => event.target.select()} className="min-w-0 flex-1 rounded-lg bg-gray-50 p-2 text-xs text-gray-700" />
        <button type="button" onClick={copy} className="shrink-0 rounded-lg border border-pink-200 px-3 py-2 text-xs text-pink-600">复制</button>
      </div>
      <p aria-live="polite" className="mt-1 text-xs text-gray-500">{message}</p>
    </div>
  );
}

export function EditChannelForm({ channel }: { channel: { id: string; name: string; hostname: string; code: string } }) {
  const [state, action, pending] = useActionState(updatePromotionChannel.bind(null, channel.id), initialState);
  return (
    <details className="mt-3 border-t border-gray-100 pt-3">
      <summary className="cursor-pointer text-sm text-pink-600">编辑渠道信息</summary>
      <form action={action} className="mt-3">
        <fieldset disabled={pending} className="space-y-3">
          <ChannelDetailsFields name={channel.name} hostname={channel.hostname} />
          <p className="text-xs text-gray-500">固定渠道标识：<code>{channel.code}</code>。编辑域名后仍需自行配置重定向。</p>
          <button type="submit" disabled={pending} className={buttonClass}>{pending ? "保存中…" : "保存信息"}</button>
          <ActionMessage state={state} />
        </fieldset>
      </form>
    </details>
  );
}

export function ChannelStatusForm({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, action, pending] = useActionState(setPromotionChannelActive.bind(null, id), initialState);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <button type="submit" disabled={pending} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 disabled:opacity-50">
        {pending ? "更新中…" : isActive ? "停用渠道" : "启用渠道"}
      </button>
      <p className="text-xs text-gray-500">停用后链接仍前往首页，停止计数，已有统计保留。</p>
      <ActionMessage state={state} />
    </form>
  );
}
