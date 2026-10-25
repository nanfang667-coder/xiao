import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const source = fs.readFileSync(new URL("../src/app/adminzhangzhang/partner-import/ImageCollector.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const origin = "https://partner.example";
const defaultSources = [{ id: 1, name: "合成来源", origin }];
function photo(id) {
  const bytes = Buffer.from([255, 216, 255, 224, id, 255, 217]);
  return { base64: bytes.toString("base64"), hash: createHash("sha256").update(bytes).digest("hex") };
}
const jpeg = photo(1);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function nodes(node, filter) {
  if (!node || typeof node !== "object") return [];
  const children = [node.props?.children].flat(Infinity);
  return [...(filter(node) ? [node] : []), ...children.flatMap(child => nodes(child, filter))];
}
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  return typeof node === "object" ? [node.props?.children].flat(Infinity).map(text).join("") : String(node);
}
function setup({ sources = defaultSources, plan, fetch, limits, failFirstObjectUrl = false, failFirstDownload = false, onEditSource } = {}) {
  const hooks = [], effects = [], timers = [], revoked = [], downloads = [], calls = [], zipFiles = [];
  const documentEvents = new Map(), windowEvents = new Map();
  let cursor = 0, tree, objectIndex = 0, photoIndex = 0, downloadAttempts = 0;
  const mockDocument = {
    visibilityState: "visible",
    addEventListener: (name, listener) => documentEvents.set(name, listener),
    removeEventListener: name => documentEvents.delete(name),
    createElement: () => ({ click() {
      downloadAttempts += 1;
      if (failFirstDownload && downloadAttempts === 1) throw new Error("Synthetic blocked download");
      downloads.push({ href: this.href, download: this.download });
    } }),
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect(callback) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(callback); } },
  };
  class MockURL extends URL {}
  MockURL.createObjectURL = () => {
    objectIndex += 1;
    if (failFirstObjectUrl && objectIndex === 1) throw new Error("Synthetic object URL failure");
    return `blob:synthetic-${objectIndex}`;
  };
  MockURL.revokeObjectURL = url => revoked.push(url);
  const mocks = {
    react,
    "react/jsx-runtime": jsxRuntime,
    "./image-actions": {
      async planPartnerImages(...args) { calls.push(["plan", ...args]); return plan ? plan(...args) : { urls: [origin + "/one", origin + "/two"] }; },
      async fetchPartnerImages(...args) { calls.push(["fetch", ...args]); return fetch ? fetch(...args) : { photos: [photo(++photoIndex)] }; },
    },
    "@/lib/partner-images-zip": { createPartnerImagesZip(files) { zipFiles.push(files); return new Uint8Array([80, 75]); } },
  };
  const exports = {};
  const executable = limits ? compiled.replace("const STEP_LIMIT = 12 * 1024 * 1024;", `const STEP_LIMIT = ${limits.step};`)
    .replace("const TOTAL_LIMIT = 64 * 1024 * 1024;", `const TOTAL_LIMIT = ${limits.total};`)
    .replace("const FILE_LIMIT = 400;", `const FILE_LIMIT = ${limits.files ?? 400};`) : compiled;
  vm.runInNewContext(executable, {
    exports, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; },
    URL: MockURL, Blob, Uint8Array, atob,
    document: mockDocument,
    window: { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, addEventListener: (name, callback) => windowEvents.set(name, callback), removeEventListener: name => windowEvents.delete(name) },
  });
  const cleanups = [];
  function render() { cursor = 0; tree = exports.ImageCollector({ sources, onEditSource }); while (effects.length) cleanups.push(effects.shift()()); return tree; }
  const find = (type, predicate = () => true) => nodes(render(), node => node.type === type && predicate(node));
  const button = label => find("button", node => text(node) === label)[0];
  const html = () => renderToStaticMarkup(render());
  function enter(url) { find("input", node => node.props.type === "url")[0].props.onChange({ target: { value: url } }); render(); }
  function start() { find("form")[0].props.onSubmit({ preventDefault() {} }); }
  async function next() { const index = timers.findIndex(timer => timer.delay < 60_000); assert.notEqual(index, -1, "expected a scheduled continuation"); timers.splice(index, 1)[0].callback(); await tick(); render(); }
  async function drain() { let count = 0; while (timers.some(timer => timer.delay < 60_000)) { assert.ok(++count < 500); await next(); } }
  async function startAndFetch() { start(); await tick(); await next(); }
  function selectMode(value) { find("input", node => node.props.type === "radio" && node.props.value === value)[0].props.onChange(); }
  render();
  return { calls, revoked, downloads, zipFiles, timers, button, find, html, enter, start, next, drain, startAndFetch, selectMode, render,
    hidden() { mockDocument.visibilityState = "hidden"; documentEvents.get("visibilitychange")?.(); },
    unmount() { cleanups.forEach(callback => callback?.()); },
  };
}

test("empty sources explain configuration and HTTPS validation never calls actions", async () => {
  const empty = setup({ sources: [] });
  assert.equal(empty.button("开始获取").props.disabled, true);
  assert.match(empty.html(), /请先在下方添加一个合作网站来源/);
  const app = setup();
  app.enter("http://partner.example/page");
  app.start();
  await tick();
  assert.equal(app.calls.length, 0);
  assert.match(app.html(), /请输入完整的 HTTPS 网址/);
});

test("editing the selected source is a non-submit action and retains collected previews", async () => {
  const edited = [];
  const sources = [...defaultSources, { id: 7, name: "合成第二来源", origin: "https://second.example" }];
  const app = setup({ sources, onEditSource: id => edited.push(id), plan: () => ({ urls: [origin + "/one"] }) });
  app.find("select")[0].props.onChange({ target: { value: "7" } });
  const edit = app.button("编辑此来源配置");
  assert.equal(edit.props.type, "button");
  assert.equal(edit.props.disabled, false);
  edit.props.onClick();
  assert.deepEqual(edited, [7]);
  assert.equal(app.calls.length, 0);
  app.enter(origin + "/one"); await app.startAndFetch(); await app.drain();
  const previous = app.find("img")[0].props.src;
  const calls = app.calls.length;
  app.button("编辑此来源配置").props.onClick();
  assert.deepEqual(edited, [7, 7]);
  assert.equal(app.find("img")[0].props.src, previous);
  assert.deepEqual(app.revoked, []);
  assert.equal(app.calls.length, calls);
});

test("source editing is disabled for invalid selection and during acquisition", async () => {
  const edited = [];
  const none = setup({ sources: [], onEditSource: id => edited.push(id) });
  assert.equal(none.button("编辑此来源配置").props.disabled, true);
  none.button("编辑此来源配置").props.onClick();
  const response = deferred();
  const app = setup({ onEditSource: id => edited.push(id), fetch: () => response.promise });
  app.find("select")[0].props.onChange({ target: { value: "999" } });
  assert.equal(app.button("编辑此来源配置").props.disabled, true);
  app.button("编辑此来源配置").props.onClick();
  app.find("select")[0].props.onChange({ target: { value: "1" } });
  app.enter(origin + "/one"); await app.startAndFetch();
  assert.equal(app.button("编辑此来源配置").props.disabled, true);
  app.button("编辑此来源配置").props.onClick();
  assert.deepEqual(edited, []);
  app.unmount(); response.resolve({ photos: [jpeg] }); await tick();
});

test("single page mode is planned explicitly and previews use private blob URLs", async () => {
  const app = setup({ plan: () => ({ urls: [origin + "/one"] }) });
  app.find("input", node => node.props.type === "radio" && node.props.value === "detail")[0].props.onChange();
  app.enter(origin + "/one"); await app.startAndFetch();
  assert.deepEqual(app.calls.map(call => Array.from(call)), [["plan", 1, origin + "/one", "detail"], ["fetch", 1, origin + "/one"]]);
  assert.equal(app.find("img")[0].props.src, "blob:synthetic-1");
  const external = app.find("a", node => node.props.target === "_blank")[0];
  assert.equal(external.props.rel, "noopener noreferrer");
  assert.equal(external.props.referrerPolicy, "no-referrer");
  assert.equal(app.button("清空图片").props.disabled, true);
  await app.next();
  assert.match(app.html(), /获取完成/);
  app.button("下载全部图片（ZIP）").props.onClick();
  assert.equal(app.zipFiles[0][0].name, "page-001-photo-01.jpg");
  assert.equal(app.downloads[0].download, "partner-images.zip");
  app.button("清空图片").props.onClick();
  assert.ok(app.revoked.includes("blob:synthetic-1"));
  assert.equal(app.find("img").length, 0);
});

test("all images download in one ZIP folder with unique names across articles and individual downloads", async () => {
  let id = 0;
  const app = setup({ fetch: () => ({ photos: [photo(++id), photo(++id)] }) });
  app.enter(origin + "/list"); await app.startAndFetch();
  await app.next();
  await app.next();
  const names = ["page-001-photo-01.jpg", "page-001-photo-02.jpg", "page-002-photo-01.jpg", "page-002-photo-02.jpg"];
  assert.deepEqual(app.find("a", node => Boolean(node.props.download)).map(node => node.props.download), names);
  app.button("下载全部图片（ZIP）").props.onClick();
  assert.deepEqual(Array.from(app.zipFiles[0], file => file.name), names);
  assert.equal(app.zipFiles[0].some(file => /[\\/]/.test(file.name)), false);
});

test("pausing an in-flight detail preserves it and continuing skips completed URLs", async () => {
  const first = deferred();
  const app = setup({ fetch: (_id, url) => url.endsWith("/one") ? first.promise : { photos: [photo(2)] } });
  app.enter(origin + "/list"); await app.startAndFetch();
  app.button("暂停获取").props.onClick();
  first.resolve({ photos: [jpeg] }); await tick();
  await app.next();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.equal(app.find("img").length, 1);
  app.button("继续获取").props.onClick(); await tick();
  assert.deepEqual(app.calls.filter(call => call[0] === "fetch").map(call => call[2]), [origin + "/one", origin + "/two"]);
  assert.equal(app.calls.filter(call => call[0] === "plan").length, 1);
  await app.next();
  assert.match(app.html(), /获取完成/);
});

test("hidden pauses before another request and unmount revokes completed images", async () => {
  const app = setup(); app.enter(origin + "/list"); await app.startAndFetch();
  app.hidden(); await app.next();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.match(app.html(), /已暂停/);
  app.unmount();
  assert.deepEqual(app.revoked, ["blob:synthetic-1"]);
});

test("unmount while fetching discards late images and does not continue", async () => {
  const response = deferred();
  const app = setup({ fetch: () => response.promise });
  app.enter(origin + "/list"); await app.startAndFetch(); app.unmount();
  response.resolve({ photos: [jpeg] }); await tick();
  assert.equal(app.find("img").length, 0);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.equal(app.timers.length, 0);
});

test("new task revokes previous object URLs and rejected images do not enter the gallery", async () => {
  let fetchCount = 0;
  const app = setup({ plan: () => ({ urls: [origin + "/one"] }), fetch: () => ++fetchCount === 1 ? { photos: [jpeg] } : { photos: Array(9).fill(jpeg) } });
  app.enter(origin + "/one"); await app.startAndFetch(); await app.next();
  assert.equal(app.find("img").length, 1);
  await app.startAndFetch();
  assert.ok(app.revoked.includes("blob:synthetic-1"));
  assert.equal(app.find("img").length, 0);
  assert.match(app.html(), /单篇图片超过 8 张/);
  await app.next();
});

test("step byte budget rejects the entire article before creating preview URLs", async () => {
  const app = setup({ plan: () => ({ urls: [origin + "/one"] }), fetch: () => ({ photos: [jpeg, jpeg, jpeg] }), limits: { step: 12, total: 64 } });
  app.enter(origin + "/one"); await app.startAndFetch();
  assert.equal(app.find("img").length, 0);
  assert.match(app.html(), /单篇图片超过 12 MB/);
  await app.next();
});

test("batch byte reserve retains previews until download and explicit save confirmation", async () => {
  const app = setup({ plan: () => ({ urls: [origin + "/one", origin + "/two", origin + "/three"] }), limits: { step: 12, total: 18 } });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.next();
  assert.equal(app.find("img").length, 1);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.match(app.html(), /本批已满/);
  assert.equal(app.button("继续获取"), undefined);
  assert.equal(app.button("清空图片").props.disabled, false);
  assert.equal(app.button("已保存本批，继续获取").props.disabled, true);
  app.button("下载本批图片（ZIP）").props.onClick(); await tick();
  assert.equal(app.find("img").length, 1);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.deepEqual(app.revoked, []);
  assert.equal(app.button("已保存本批，继续获取").props.disabled, false);
  app.button("已保存本批，继续获取").props.onClick(); await tick();
  assert.deepEqual(app.revoked, ["blob:synthetic-1"]);
  assert.equal(app.downloads[0].href, "blob:synthetic-2");
  assert.equal(app.revoked.includes(app.downloads[0].href), false);
  assert.equal(app.find("a", node => node.props.download === "page-002-photo-01.jpg").length, 1);
  await app.next();
  assert.equal(app.button("已保存本批，继续获取").props.disabled, true);
  app.button("下载本批图片（ZIP）").props.onClick();
  app.button("已保存本批，继续获取").props.onClick(); await tick(); await app.next();
  assert.deepEqual(app.calls.filter(call => call[0] === "fetch").map(call => call[2]), [origin + "/one", origin + "/two", origin + "/three"]);
  assert.equal(app.find("a", node => node.props.download === "page-003-photo-01.jpg").length, 1);
  assert.match(app.html(), /获取完成/);
});

test("three pages are read in order with exact page arguments and a three-page ceiling", async () => {
  const app = setup({ plan: (_id, url, mode, page) => {
    assert.equal(mode, "three");
    return { urls: [origin + `/article-${page}`], pageUrl: url, nextPageUrl: origin + `/list?page=${page + 1}` };
  } });
  app.selectMode("three"); app.enter(origin + "/list?page=1"); await app.startAndFetch(); await app.drain();
  assert.deepEqual(app.calls.filter(call => call[0] === "plan").map(call => call.slice(2)), [
    [origin + "/list?page=1", "three", 1], [origin + "/list?page=2", "three", 2], [origin + "/list?page=3", "three", 3],
  ]);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 3);
  assert.match(app.html(), /已读列表 3 \/ 3 页/);
  assert.match(app.html(), /当前文章来自第 3 页列表/);
  assert.match(app.html(), /获取完成/);
});

test("three bounded lists complete 150 distinct articles without requesting a fourth list", async () => {
  const app = setup({ plan: (_id, url, _mode, page) => ({ pageUrl: url,
    urls: Array.from({ length: 50 }, (_, index) => origin + `/article-${(page - 1) * 50 + index + 1}`),
    nextPageUrl: origin + `/list?page=${page + 1}` }) });
  app.selectMode("three"); app.enter(origin + "/list?page=1"); await app.startAndFetch(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "plan").length, 3);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 150);
  assert.equal(app.find("img").length, 150);
  assert.match(app.html(), /已处理 150 \/ 150 篇/);
});

test("missing next page reports the actual number instead of claiming three pages", async () => {
  const app = setup({ plan: () => ({ urls: [origin + "/one"], nextPageUrl: null }) });
  app.selectMode("three"); app.enter(origin + "/list"); await app.startAndFetch(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "plan").length, 1);
  assert.match(app.html(), /未找到下一页，实际读取 1 页/);
  assert.match(app.html(), /已读列表 1 \/ 3 页/);
});

test("repeated next-page links stop without following a pagination loop", async () => {
  const app = setup({ plan: (_id, url) => ({ urls: [origin + "/one"], pageUrl: url, nextPageUrl: url }) });
  app.selectMode("three"); app.enter(origin + "/list"); await app.startAndFetch(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "plan").length, 1);
  assert.match(app.html(), /下一页链接重复/);
});

test("a canonical pagination loop stops without counting or refetching the duplicate page", async () => {
  const app = setup({ plan: (_id, _url, _mode, page) => ({ urls: [origin + `/article-${page}`], pageUrl: origin + "/canonical", nextPageUrl: origin + "/alias" }) });
  app.selectMode("three"); app.enter(origin + "/list"); await app.startAndFetch(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "plan").length, 2);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.match(app.html(), /识别到重复列表页/);
  assert.match(app.html(), /已读列表 1 \/ 3 页/);
});

test("failed second page preserves images and continuing retries that page only", async () => {
  let secondAttempts = 0;
  const app = setup({ plan: (_id, url, _mode, page) => page === 2 && ++secondAttempts === 1 ? { error: "读取超时。" }
    : { urls: [origin + `/article-${page}`], pageUrl: url, nextPageUrl: page === 1 ? origin + "/list?page=2" : null } });
  app.selectMode("three"); app.enter(origin + "/list?page=1"); await app.startAndFetch(); await app.drain();
  assert.equal(app.find("img").length, 1);
  assert.match(app.html(), /第 2 页读取失败/);
  assert.match(app.html(), /已读列表 1 \/ 3 页/);
  app.button("继续获取").props.onClick(); await tick(); await app.drain();
  assert.deepEqual(app.calls.filter(call => call[0] === "plan").map(call => call[4]), [1, 2, 2]);
  assert.deepEqual(app.calls.filter(call => call[0] === "fetch").map(call => call[2]), [origin + "/article-1", origin + "/article-2"]);
  assert.equal(app.find("img").length, 2);
  assert.match(app.html(), /实际读取 2 页/);
});

test("hiding during list planning retains that page but pauses before fetching an article", async () => {
  const page = deferred();
  const app = setup({ plan: () => page.promise });
  app.selectMode("three"); app.enter(origin + "/list"); app.start(); await tick();
  app.hidden();
  page.resolve({ urls: [origin + "/one"], pageUrl: origin + "/list", nextPageUrl: null });
  await tick(); await app.next();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 0);
  assert.match(app.html(), /已读列表 1 \/ 3 页/);
  app.button("继续获取").props.onClick(); await tick(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "plan").length, 1);
  assert.equal(app.find("img").length, 1);
});

test("unmounting during a list action ignores late plans and starts no photo request", async () => {
  const page = deferred();
  const app = setup({ plan: () => page.promise });
  app.selectMode("three"); app.enter(origin + "/list"); app.start(); await tick(); app.unmount();
  page.resolve({ urls: [origin + "/one"], nextPageUrl: origin + "/next" }); await tick();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 0);
  assert.equal(app.timers.length, 0);
});

test("article URLs and image hashes are deduplicated across list pages", async () => {
  const app = setup({ plan: (_id, url, _mode, page) => ({ urls: page === 1 ? [origin + "/one", origin + "/two"] : [origin + "/two", origin + "/three"], pageUrl: url,
    nextPageUrl: page === 1 ? origin + "/list?page=2" : null }),
  fetch: (_id, url) => ({ photos: url.endsWith("/three") ? [photo(2)] : [jpeg, jpeg] }) });
  app.selectMode("three"); app.enter(origin + "/list?page=1"); await app.startAndFetch(); await app.drain();
  assert.deepEqual(app.calls.filter(call => call[0] === "fetch").map(call => call[2]), [origin + "/one", origin + "/two", origin + "/three"]);
  assert.equal(app.find("img").length, 2);
  assert.match(app.html(), /已跳过重复图片/);
  assert.deepEqual(app.find("a", node => Boolean(node.props.download)).map(node => node.props.download), ["page-001-photo-01.jpg", "page-003-photo-01.jpg"]);
});

test("hashes remain seen after a batch download, but reset for a new task", async () => {
  const app = setup({ plan: () => ({ urls: [origin + "/one", origin + "/two", origin + "/three"] }),
    fetch: (_id, url) => ({ photos: [url.endsWith("/three") ? photo(2) : jpeg] }), limits: { step: 12, total: 18 } });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.next();
  app.button("下载本批图片（ZIP）").props.onClick();
  app.button("已保存本批，继续获取").props.onClick(); await tick(); await app.drain();
  assert.equal(app.find("img").length, 1);
  assert.equal(app.find("a", node => node.props.download === "page-003-photo-01.jpg").length, 1);
  assert.match(app.html(), /已跳过重复图片/);
  app.start(); await tick(); await app.next();
  assert.equal(app.find("a", node => node.props.download === "page-001-photo-01.jpg").length, 1);
});

test("failed browser image creation does not mark its hash as successfully collected", async () => {
  const app = setup({ fetch: () => ({ photos: [jpeg] }), failFirstObjectUrl: true });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.drain();
  assert.equal(app.find("img").length, 1);
  assert.equal(app.find("a", node => node.props.download === "page-002-photo-01.jpg").length, 1);
});

test("file-count reserve makes a resumable batch before another article is requested", async () => {
  let id = 0;
  const app = setup({ fetch: () => ({ photos: [photo(++id), photo(++id)] }), limits: { step: 100, total: 10_000, files: 9 } });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.next();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.match(app.html(), /本批已满/);
  app.button("下载本批图片（ZIP）").props.onClick();
  app.button("已保存本批，继续获取").props.onClick(); await tick(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 2);
  assert.equal(app.find("a", node => node.props.download === "page-002-photo-02.jpg").length, 1);
  assert.equal(app.revoked.includes(app.downloads[0].href), false);
});

test("failed batch download revokes its ZIP URL, retains photos and permits another attempt", async () => {
  const app = setup({ limits: { step: 12, total: 18 }, failFirstDownload: true });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.next();
  app.button("下载本批图片（ZIP）").props.onClick();
  assert.equal(app.button("已保存本批，继续获取").props.disabled, true);
  assert.equal(app.find("img").length, 1);
  assert.deepEqual(app.revoked, ["blob:synthetic-2"]);
  assert.match(app.html(), /图片仍保留在本页/);
  app.button("下载本批图片（ZIP）").props.onClick();
  assert.equal(app.button("已保存本批，继续获取").props.disabled, false);
  assert.equal(app.find("img").length, 1);
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 1);
  assert.equal(app.revoked.includes("blob:synthetic-3"), false);
  app.button("已保存本批，继续获取").props.onClick(); await tick(); await app.drain();
  assert.equal(app.calls.filter(call => call[0] === "fetch").length, 2);
});

test("API photo hints travel only with their matching article and explicit empty hints never use the HTML call", async () => {
  const hints = { [origin + "/one"]: [origin + "/one.jpg"], [origin + "/two"]: [] };
  const app = setup({ plan: () => ({ urls: Object.keys(hints), photoHints: hints }),
    fetch: (_id, _url, photos) => photos.length ? { photos: [jpeg] } : { error: "没有图片" } });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.drain();
  const fetched = app.calls.filter(call => call[0] === "fetch");
  assert.deepEqual(fetched.map(call => call.slice(1, 3)), [[1, origin + "/one"], [1, origin + "/two"]]);
  assert.deepEqual(fetched.map(call => Array.from(call[3])), [[origin + "/one.jpg"], []]);
  assert.ok(fetched.every(call => call.length === 4));
  assert.equal(app.find("img").length, 1);
  assert.match(app.html(), /获取完成/);
});

test("malformed photo-hint plans never advance the page or start an article and can retry atomically", async () => {
  const one = origin + "/one";
  for (const invalid of [null, [], {}, { [one]: null }, { [one]: ["http://partner.example/x.jpg"] },
    { [one]: Array(9).fill(origin + "/x.jpg") }, { [one]: [origin + "/x.jpg#private"] },
    { [one]: [origin + "/x.jpg"], extra: [] }]) {
    let attempt = 0;
    const app = setup({ plan: () => ({ urls: [one], photoHints: ++attempt === 1 ? invalid : { [one]: [] } }) });
    app.selectMode("three"); app.enter(origin + "/list"); app.start(); await tick();
    assert.equal(app.calls.filter(call => call[0] === "fetch").length, 0);
    assert.match(app.html(), /页面结果不完整/);
    assert.match(app.html(), /已读列表 0 \/ 3 页/);
    app.button("继续获取").props.onClick(); await tick(); await app.drain();
    assert.deepEqual(app.calls.filter(call => call[0] === "plan").map(call => call[4]), [1, 1]);
    assert.deepEqual(Array.from(app.calls.find(call => call[0] === "fetch")[3]), []);
    assert.match(app.html(), /已读列表 1 \/ 3 页/);
  }
});

test("photo hints survive a pause and repeated articles keep their first page hints", async () => {
  const app = setup({ plan: (_id, pageUrl, _mode, page) => ({
    urls: page === 1 ? [origin + "/one", origin + "/two"] : [origin + "/one", origin + "/three"],
    pageUrl, nextPageUrl: page === 1 ? origin + "/list?page=2" : null,
    photoHints: page === 1 ? { [origin + "/one"]: [origin + "/first.jpg"], [origin + "/two"]: [] }
      : { [origin + "/one"]: [origin + "/changed.jpg"], [origin + "/three"]: [origin + "/third.jpg"] },
  }) });
  app.selectMode("three"); app.enter(origin + "/list?page=1"); await app.startAndFetch();
  app.button("暂停获取").props.onClick(); await app.drain();
  app.button("继续获取").props.onClick(); await tick(); await app.drain();
  const calls = app.calls.filter(call => call[0] === "fetch");
  assert.deepEqual(calls.map(call => call[2]), [origin + "/one", origin + "/two", origin + "/three"]);
  assert.deepEqual(calls.map(call => Array.from(call[3])), [[origin + "/first.jpg"], [], [origin + "/third.jpg"]]);
});

test("photo hints survive batch confirmation and are released for a new HTML task", async () => {
  let apiMode = true;
  const urls = [origin + "/one", origin + "/two"];
  const app = setup({ plan: () => apiMode ? { urls, photoHints: { [urls[0]]: [origin + "/one.jpg"], [urls[1]]: [] } } : { urls: [urls[0]] },
    limits: { step: 12, total: 18 } });
  app.enter(origin + "/list"); await app.startAndFetch(); await app.drain();
  assert.match(app.html(), /本批已满/);
  app.button("下载本批图片（ZIP）").props.onClick();
  app.button("已保存本批，继续获取").props.onClick(); await tick(); await app.drain();
  assert.deepEqual(Array.from(app.calls.filter(call => call[0] === "fetch")[1][3]), []);
  apiMode = false;
  app.button("清空图片").props.onClick(); app.start(); await tick(); await app.drain();
  const final = app.calls.filter(call => call[0] === "fetch").at(-1);
  assert.equal(final[2], urls[0]);
  assert.equal(final.length, 3);
});
