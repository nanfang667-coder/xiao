"use client";

import { useEffect, useRef, useState } from "react";
import { createPartnerImagesZip } from "@/lib/partner-images-zip";
import { fetchPartnerImages, planPartnerImages } from "./image-actions";

type Source = { id: number; name: string; origin: string };
type Mode = "list" | "detail" | "three";
type Photo = { name: string; bytes: Uint8Array; url: string; hash: string };
type Article = { url: string; listPage: number };
type Group = { page: number; listPage: number; sourceUrl: string; photos: Photo[]; error?: string; message?: string };
type Task = {
  sourceId: number; mode: Mode; articles: Article[]; next: number; pagesRead: number;
  pendingPage: { url: string; number: number } | null;
  pageUrls: Set<string>; articleUrls: Set<string>; imageHashes: Set<string>; photoHints: Map<string, string[]>;
};
type Phase = "idle" | "planning" | "running" | "pausing" | "paused" | "batch" | "done";
const STEP_LIMIT = 12 * 1024 * 1024;
const TOTAL_LIMIT = 64 * 1024 * 1024;
const FILE_LIMIT = 400;
const inputClass = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:bg-gray-50";
const buttonClass = "rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const secondaryClass = "rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50";
class ImageResultError extends Error {}

function validPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function validPhotoHint(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f#\\]/u.test(value)) return false;
  const authority = value.match(/^https:\/\/([^/?]*)/i)?.[1];
  if (!authority || authority.includes("@")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443");
  } catch { return false; }
}

function pagePhotoHints(value: unknown, urls: string[]): Map<string, string[]> | null {
  const hints = new Map<string, string[]>();
  if (value === undefined) return hints;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const expected = new Set(urls.map(url => validPageUrl(url)!));
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.size || keys.some(key => typeof key !== "string" || !expected.has(key))) return null;
    for (const url of expected) {
      const property = Object.getOwnPropertyDescriptor(value, url);
      if (!property || !("value" in property) || !Array.isArray(property.value) || property.value.length > 8) return null;
      const photos = Array.from(property.value);
      if (!photos.every(validPhotoHint)) return null;
      hints.set(url, photos);
    }
    return hints;
  } catch { return null; }
}

function decodePhotos(photos: { base64: string; hash: string }[]): { bytes: Uint8Array; hash: string }[] {
  if (photos.length > 8) throw new ImageResultError("单篇图片超过 8 张，请调整来源规则后重新获取。");
  let size = 0;
  return photos.map(({ base64, hash }) => {
    if (!/^[a-f0-9]{64}$/i.test(hash) || !base64 || base64.length % 4 !== 0 || base64.length > Math.ceil(STEP_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new ImageResultError("图片数据不完整，请稍后重新获取。");
    }
    const data = atob(base64);
    size += data.length;
    if (size > STEP_LIMIT) throw new ImageResultError("单篇图片超过 12 MB，请调整来源规则后重新获取。");
    const bytes = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new ImageResultError("图片格式不正确，请稍后重新获取。");
    }
    return { bytes, hash: hash.toLowerCase() };
  });
}

export function ImageCollector({ sources, onEditSource }: { sources: Source[]; onEditSource?: (id: number) => void }) {
  const [sourceId, setSourceId] = useState(String(sources[0]?.id ?? ""));
  const [mode, setMode] = useState<Mode>("list");
  const [pageUrl, setPageUrl] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [pagesRead, setPagesRead] = useState(0);
  const [runMode, setRunMode] = useState<Mode>("list");
  const [currentListPage, setCurrentListPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [batchDownloaded, setBatchDownloaded] = useState(false);
  const mounted = useRef(true);
  const active = useRef(false);
  const busyRef = useRef(false);
  const task = useRef<Task | null>(null);
  const memory = useRef(0);
  const filesInBatch = useRef(0);
  const objectUrls = useRef(new Set<string>());
  const downloadUrls = useRef(new Set<string>());
  const generation = useRef(0);

  function revokeImages() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
    memory.current = 0;
    filesInBatch.current = 0;
  }

  useEffect(() => {
    mounted.current = true;
    const urls = objectUrls.current;
    const downloads = downloadUrls.current;
    function pause() {
      active.current = false;
      if (busyRef.current) setPhase("pausing");
    }
    function onVisibility() { if (document.visibilityState === "hidden") pause(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pause);
    return () => {
      mounted.current = false;
      active.current = false;
      generation.current += 1;
      task.current?.photoHints.clear();
      task.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      for (const url of downloads) URL.revokeObjectURL(url);
      downloads.clear();
    };
  }, []);

  function clearImages() {
    if (busyRef.current) return;
    generation.current += 1;
    task.current?.photoHints.clear();
    task.current = null;
    revokeImages();
    for (const url of downloadUrls.current) URL.revokeObjectURL(url);
    downloadUrls.current.clear();
    setGroups([]);
    setTotal(0);
    setCompleted(0);
    setPagesRead(0);
    setCurrentListPage(0);
    setNotice("");
    setError("");
    setBatchDownloaded(false);
    setPhase("idle");
  }

  async function collect(current: Task) {
    if (busyRef.current) return;
    const run = generation.current;
    const valid = () => mounted.current && generation.current === run;
    busyRef.current = true;
    active.current = true;
    setBusy(true);
    setError("");
    let batchFull = false;
    try {
      while (valid() && active.current) {
        if (current.next >= current.articles.length) {
          const page = current.pendingPage;
          if (!page) break;
          setPhase("planning");
          const planned = current.mode === "three"
            ? await planPartnerImages(current.sourceId, page.url, "three", page.number)
            : await planPartnerImages(current.sourceId, page.url, current.mode);
          if (!valid()) return;
          if ("error" in planned) { setError(`第 ${page.number} 页读取失败：${planned.error} 点击继续可重试这一页。`); break; }
          const pageUrl = validPageUrl(planned.pageUrl ?? page.url);
          const urls = planned.urls;
          const nextPage = planned.nextPageUrl ? validPageUrl(planned.nextPageUrl) : null;
          if (!pageUrl || !Array.isArray(urls) || urls.length > 50 || urls.some(url => typeof url !== "string" || !validPageUrl(url)) || (planned.nextPageUrl && !nextPage)) {
            setError("页面结果不完整，请检查来源规则后继续重试。");
            break;
          }
          const hints = pagePhotoHints("photoHints" in planned ? planned.photoHints : undefined, urls);
          if (!hints) {
            setError("页面结果不完整，请检查来源规则后继续重试。");
            break;
          }
          if (current.pageUrls.has(pageUrl)) {
            current.pendingPage = null;
            setNotice(`识别到重复列表页，已停止。实际读取 ${current.pagesRead} 页。`);
            break;
          }
          current.pageUrls.add(page.url);
          current.pageUrls.add(pageUrl);
          current.pagesRead += 1;
          for (const raw of urls) {
            const url = validPageUrl(raw)!;
            if (!current.articleUrls.has(url)) {
              current.articleUrls.add(url);
              current.articles.push({ url, listPage: page.number });
              if (hints.has(url)) current.photoHints.set(url, hints.get(url)!);
            }
          }
          setPagesRead(current.pagesRead);
          setTotal(current.articles.length);
          current.pendingPage = null;
          if (current.mode === "three" && current.pagesRead < 3) {
            if (!nextPage) setNotice(`未找到下一页，实际读取 ${current.pagesRead} 页。`);
            else if (current.pageUrls.has(nextPage)) setNotice(`下一页链接重复，已停止。实际读取 ${current.pagesRead} 页。`);
            else current.pendingPage = { url: nextPage, number: page.number + 1 };
          }
          if (current.articles.length === 0 && !current.pendingPage) setNotice("没有找到可获取图片的文章，请检查网址和来源规则。");
          // Do not begin an article or the next list page until pause can take effect.
          await new Promise<void>(resolve => window.setTimeout(resolve, 100));
          continue;
        }
        // Reserve the maximum response before fetching so no article is discarded at a batch boundary.
        if (filesInBatch.current > 0 && (memory.current + STEP_LIMIT > TOTAL_LIMIT || filesInBatch.current + 8 > FILE_LIMIT)) {
          batchFull = true;
          break;
        }
        setPhase("running");
        const index = current.next;
        const article = current.articles[index];
        setCurrentListPage(article.listPage);
        const group: Group = { page: index + 1, listPage: article.listPage, sourceUrl: article.url, photos: [] };
        try {
          const result = current.photoHints.has(article.url)
            ? await fetchPartnerImages(current.sourceId, article.url, current.photoHints.get(article.url)!)
            : await fetchPartnerImages(current.sourceId, article.url);
          if (!valid()) return;
          if (result.error) group.error = result.error;
          else {
            const received = decodePhotos(result.photos ?? []);
            const accepted = new Set(current.imageHashes);
            const photos = received.filter(photo => {
              if (accepted.has(photo.hash)) return false;
              accepted.add(photo.hash);
              return true;
            });
            const bytes = photos.reduce((sum, photo) => sum + photo.bytes.byteLength, 0);
            for (const [photoIndex, photo] of photos.entries()) {
              const url = URL.createObjectURL(new Blob([new Uint8Array(photo.bytes)], { type: "image/jpeg" }));
              objectUrls.current.add(url);
              group.photos.push({ ...photo, url, name: `page-${String(index + 1).padStart(3, "0")}-photo-${String(photoIndex + 1).padStart(2, "0")}.jpg` });
            }
            memory.current += bytes;
            filesInBatch.current += photos.length;
            for (const photo of photos) current.imageHashes.add(photo.hash);
            if (!received.length) group.error = "这篇文章没有找到图片。";
            else if (!photos.length) group.message = "已跳过重复图片。";
            else if (photos.length < received.length) group.message = `已跳过 ${received.length - photos.length} 张重复图片。`;
          }
        } catch (cause) {
          if (!valid()) return;
          for (const photo of group.photos) {
            URL.revokeObjectURL(photo.url);
            objectUrls.current.delete(photo.url);
          }
          group.photos = [];
          group.error = cause instanceof ImageResultError ? cause.message : "本篇获取失败，请检查来源配置或稍后重试。";
        }
        current.next += 1;
        setCompleted(current.next);
        setGroups(previous => [...previous, group]);
        // A short yield lets pause, hiding the tab and navigation stop the next request.
        await new Promise<void>(resolve => window.setTimeout(resolve, 100));
      }
    } catch {
      if (valid()) setError("获取未完成，请检查网络或重新登录后重试。");
    } finally {
      active.current = false;
      busyRef.current = false;
      if (valid()) {
        setBusy(false);
        if (batchFull) setBatchDownloaded(false);
        setPhase(batchFull ? "batch" : !current.pendingPage && current.next >= current.articles.length ? "done" : "paused");
      }
    }
  }

  function begin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const selected = sources.find(source => String(source.id) === (sourceId || String(sources[0]?.id ?? "")) && source.id >= 1);
    const url = validPageUrl(pageUrl.trim());
    if (!selected) { setError("请先添加并选择合作网站来源。"); return; }
    if (!url) { setError("请输入完整的 HTTPS 网址。"); return; }
    clearImages();
    const next: Task = { sourceId: selected.id, mode, articles: [], next: 0, pagesRead: 0,
      pendingPage: { url, number: 1 }, pageUrls: new Set(), articleUrls: new Set(), imageHashes: new Set(), photoHints: new Map() };
    task.current = next;
    setRunMode(mode);
    void collect(next);
  }

  function pause() {
    active.current = false;
    setPhase(busyRef.current ? "pausing" : "paused");
  }

  function downloadAll(): boolean {
    const files = groups.flatMap(group => group.photos.map(photo => ({ name: photo.name, bytes: photo.bytes })));
    if (!files.length) return false;
    let downloadUrl: string | null = null;
    try {
      const zip = createPartnerImagesZip(files);
      const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: "application/zip" }));
      downloadUrl = url;
      downloadUrls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "partner-images.zip";
      anchor.click();
      window.setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 60_000);
      setError("");
      if (phase === "batch") setBatchDownloaded(true);
      return true;
    } catch {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        downloadUrls.current.delete(downloadUrl);
      }
      setError("下载未完成，图片仍保留在本页，请重新下载本批图片。");
      return false;
    }
  }

  function continueAfterSavingBatch() {
    if (busyRef.current || !task.current || !batchDownloaded) return;
    revokeImages();
    setGroups([]);
    setBatchDownloaded(false);
    void collect(task.current);
  }

  const count = groups.reduce((sum, group) => sum + group.photos.length, 0);
  const status = phase === "planning" ? "正在读取页面…" : phase === "running" ? "正在逐篇获取图片…"
    : phase === "pausing" ? "正在暂停，当前请求完成后停止…" : phase === "paused" ? "已暂停，可以继续获取。"
      : phase === "batch" ? "本批已满，请先下载并确认保存，再继续获取。未处理的文章会保留。"
      : phase === "done" ? "获取完成。" : "选择来源并输入网址开始获取。";
  const canResume = phase === "paused";
  const actualSourceId = sourceId || String(sources[0]?.id ?? "");
  const selectedSource = sources.find(source => String(source.id) === actualSourceId && source.id >= 1);

  return <section className="rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="image-collector-heading">
    <h2 id="image-collector-heading" className="font-bold text-gray-800">获取合作网站图片</h2>
    <p className="mt-2 text-sm leading-6 text-gray-500">只获取图片，不建立帖子或待审核稿。图片仅保留在当前页面，离开或刷新后清除，请及时下载。</p>
    {sources.length === 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">请先在下方添加一个合作网站来源。</p>}
    <form onSubmit={begin} className="mt-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1 text-sm font-medium text-gray-700">选择来源
          <select value={actualSourceId} onChange={event => setSourceId(event.target.value)} disabled={busy || sources.length === 0} required className={inputClass}>
            {sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.origin}</option>)}
          </select>
        </label>
        {onEditSource && <button type="button" disabled={busy || !selectedSource}
          onClick={() => { if (!busyRef.current && selectedSource) onEditSource(selectedSource.id); }} className={secondaryClass}>编辑此来源配置</button>}
      </div>
      <fieldset disabled={busy} className="flex flex-wrap gap-4 text-sm text-gray-700">
        <legend className="mb-2 font-medium">获取方式</legend>
        <label className="flex items-center gap-2"><input type="radio" name="image-mode" value="list" checked={mode === "list"} onChange={() => setMode("list")} />列表页</label>
        <label className="flex items-center gap-2"><input type="radio" name="image-mode" value="three" checked={mode === "three"} onChange={() => setMode("three")} />前三页</label>
        <label className="flex items-center gap-2"><input type="radio" name="image-mode" value="detail" checked={mode === "detail"} onChange={() => setMode("detail")} />单篇文章</label>
      </fieldset>
      <label className="block text-sm font-medium text-gray-700">{mode === "detail" ? "单篇文章网址" : mode === "three" ? "第一页列表网址" : "列表页网址"}
        <input type="url" value={pageUrl} onChange={event => setPageUrl(event.target.value)} disabled={busy} required maxLength={2_000} className={inputClass} placeholder="https://partner.example/posts?page=1" autoComplete="off" spellCheck={false} />
      </label>
      <p className="text-xs leading-5 text-gray-500">{mode === "three" ? "从第一页开始，最多读取 3 页，每页最多 50 篇；没有下一页时会提前停止。" : "只处理这一页，不自动翻页。"}重复图片自动跳过；每批最多 400 张、64 MB，满批下载后可继续。切换标签页会暂停后续获取。</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy || !sources.some(source => source.id >= 1)} className={buttonClass}>开始获取</button>
        {busy && phase !== "pausing" && <button type="button" onClick={pause} className={secondaryClass}>暂停获取</button>}
        {canResume && <button type="button" disabled={busy} onClick={() => task.current && void collect(task.current)} className={secondaryClass}>继续获取</button>}
        {phase === "batch" && <>
          <button type="button" disabled={busy} onClick={downloadAll} className={buttonClass}>下载本批图片（ZIP）</button>
          <button type="button" disabled={busy || !batchDownloaded} onClick={continueAfterSavingBatch} className={secondaryClass}>已保存本批，继续获取</button>
        </>}
        <button type="button" disabled={busy || groups.length === 0} onClick={clearImages} className={secondaryClass}>清空图片</button>
      </div>
    </form>
    <p role="status" aria-live="polite" className="mt-4 text-sm text-gray-700">{status} {runMode === "three" && `已读列表 ${pagesRead} / 3 页。`}{currentListPage > 0 && runMode === "three" && `当前文章来自第 ${currentListPage} 页列表。`}已处理 {completed} / {total} 篇，本批 {count} 张图片。</p>
    {notice && <p className="mt-3 text-sm text-amber-800">{notice}</p>}
    {phase === "batch" && <p className="mt-3 text-sm text-amber-800">请确认 ZIP 已保存到电脑；如下载被取消或拦截，可重新下载。继续获取会清空当前批的图片预览。</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {count > 0 && phase !== "batch" && <button type="button" onClick={downloadAll} className={`${buttonClass} mt-4`}>下载全部图片（ZIP）</button>}
    <div className="mt-4 space-y-5">
      {groups.map(group => <section key={group.page} aria-label={`第 ${group.page} 篇图片`} className="rounded-xl border border-gray-100 p-3">
        <a href={group.sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="break-all text-xs text-pink-600">第 {group.page} 篇来源：{group.sourceUrl}</a>
        {runMode === "three" && <p className="mt-1 text-xs text-gray-500">来自第 {group.listPage} 页列表</p>}
        {group.error && <p className="mt-2 text-sm text-amber-800">{group.error}</p>}
        {group.message && <p className="mt-2 text-sm text-gray-500">{group.message}</p>}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {group.photos.map(photo => <figure key={photo.name} className="min-w-0">
            {/* Blob URLs contain already downloaded JPEG data; no remote image request. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`第 ${group.page} 篇图片 ${photo.name}`} loading="lazy" className="aspect-[3/4] w-full rounded-lg bg-gray-50 object-contain" />
            <figcaption className="mt-2 text-center"><a href={photo.url} download={photo.name} className="text-sm font-medium text-pink-600">下载图片</a></figcaption>
          </figure>)}
        </div>
      </section>)}
    </div>
  </section>;
}
