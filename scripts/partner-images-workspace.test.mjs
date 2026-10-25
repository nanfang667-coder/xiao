import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { DISCUZ_FIRST_POST_PHOTO_SELECTOR } from "../src/lib/partner-discuz-image-rules.ts";

const sourceRoot = "../src/app/adminzhangzhang/partner-import/";
const sources = [
  { id: 7, name: "合成甲", origin: "https://first.example", rules: '{"postLinkSelector":"article a"}', imageOrigins: '["https://images.example"]' },
  { id: 8, name: "合成乙", origin: "https://second.example", rules: '{"photoSelector":".photos img"}', imageOrigins: "[]" },
];
const defaultRules = '{"postLinkSelector":"h2 a"}';

function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}

// Small hook/reconciliation fixture: preserve component instances by stable type, position and key.
// Only synthetic source configuration is supplied; imported server actions are mocked.
function workspace() {
  const instances = new Map(), typeIds = new Map(), nativeDetails = new Map(), scrolls = [];
  let current, tree, records = [], visibleDetails = new Set(), saves = 0;
  const nextHook = initial => {
    const instance = current, index = instance.cursor++;
    if (!(index in instance.hooks)) instance.hooks[index] = typeof initial === "function" ? initial() : initial;
    return [instance, index];
  };
  const react = {
    useState(initial) {
      const [instance, index] = nextHook(initial);
      return [instance.hooks[index], value => { instance.hooks[index] = typeof value === "function" ? value(instance.hooks[index]) : value; }];
    },
    useRef(initial) { const [instance, index] = nextHook(() => ({ current: initial })); return instance.hooks[index]; },
    useActionState() { nextHook(null); return [{}, () => { saves += 1; }, false]; },
  };
  function load(file, mocks) {
    const exports = {};
    const source = fs.readFileSync(new URL(sourceRoot + file, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(compiled, { exports, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; } });
    return exports;
  }
  function ImageCollector(props) {
    const [preview, setPreview] = react.useState("blob:initial-preview");
    return jsx.jsxs("section", { "data-preview": preview, children: [
      jsx.jsx("button", { type: "button", onClick: () => setPreview("blob:already-collected"), children: "合成预览状态" }),
      jsx.jsx("button", { type: "button", onClick: () => props.onEditSource(7), children: "合成编辑按钮" }),
    ] });
  }
  const forms = load("ImportForms.tsx", { react, "react/jsx-runtime": jsx,
    "@/lib/partner-discuz-image-rules": { DISCUZ_FIRST_POST_PHOTO_SELECTOR },
    "./actions": { savePartnerSource() { saves += 1; } } });
  const { PartnerImagesWorkspace } = load("PartnerImagesWorkspace.tsx", {
    react, "react/jsx-runtime": jsx, "./ImageCollector": { ImageCollector }, "./ImportForms": forms,
  });
  const panel = {
    querySelectorAll(selector) { assert.equal(selector, "details"); return [...nativeDetails.values()]; },
    scrollIntoView(options) { scrolls.push({ ...options }); },
  };
  function resolve(element, path) {
    if (Array.isArray(element)) return element.map((child, index) => resolve(child, `${path}.${index}`));
    if (!element || typeof element !== "object" || !element.props) return element;
    if (typeof element.type === "function") {
      if (!typeIds.has(element.type)) typeIds.set(element.type, typeIds.size + 1);
      const id = `${path}:${typeIds.get(element.type)}:${element.key ?? ""}`;
      if (!instances.has(id)) instances.set(id, { hooks: [], cursor: 0 });
      const previous = current;
      current = instances.get(id);
      current.cursor = 0;
      const rendered = element.type(element.props);
      records.push({ ...element, instance: current, id });
      current = previous;
      return resolve(rendered, `${id}/render`);
    }
    if (element.type === "div" && element.props.ref) element.props.ref.current = panel;
    if (element.type === "details") {
      visibleDetails.add(path);
      if (!nativeDetails.has(path)) nativeDetails.set(path, { open: Boolean(element.props.open), previousOpen: element.props.open });
      const native = nativeDetails.get(path);
      if (native.previousOpen !== element.props.open) native.open = Boolean(element.props.open);
      native.previousOpen = element.props.open;
    }
    return { ...element, props: { ...element.props, children: resolve(element.props.children, `${path}/children`) } };
  }
  function render() {
    records = [];
    visibleDetails = new Set();
    tree = resolve(jsx.jsx(PartnerImagesWorkspace, { sources, defaultRules }), "root");
    for (const path of nativeDetails.keys()) if (!visibleDetails.has(path)) nativeDetails.delete(path);
    return tree;
  }
  const record = name => records.find(item => item.type.name === name);
  const find = (type, predicate = () => true) => nodes(render(), item => item.type === type && predicate(item));
  render();
  return { render, find, scrolls, record, saves: () => saves,
    edit(id) { record("ImageCollector").props.onEditSource(id); render(); },
    details: () => [...nativeDetails.values()],
  };
}

test("editing a current source opens both configuration layers, scrolls and performs no save", () => {
  const app = workspace();
  app.edit(8);
  assert.equal(app.record("SourceSettings").props.selectedSourceId, "8");
  assert.equal(app.find("input", node => node.props.name === "sourceId")[0].props.value, 8);
  assert.equal(app.find("textarea", node => node.props.name === "rules")[0].props.value, sources[1].rules);
  assert.equal(app.find("button", node => node.props.children === "保存来源配置").length, 1);
  assert.equal(app.find("button", node => node.props.children === "恢复默认帖子链接规则").length, 1);
  assert.equal(app.details().every(details => details.open), true);
  assert.deepEqual(app.scrolls, [{ behavior: "smooth", block: "start" }]);
  assert.equal(app.saves(), 0);
  assert.deepEqual(Object.keys(app.record("ImageCollector").props.sources[0]).sort(), ["id", "name", "origin"]);
  assert.equal(app.record("SourceSettings").props.sources[0].rules, sources[0].rules);
});

test("same-source repeated editing reopens collapsed layers without resetting unsaved JSON or preview identity", () => {
  const app = workspace();
  app.edit(7);
  const editor = app.record("SourceEditor"), collector = app.record("ImageCollector"), settings = app.record("SourceSettings");
  app.find("textarea", node => node.props.name === "rules")[0].props.onChange({ target: { value: '{"edited":true}' } });
  app.find("button", node => node.props.children === "合成预览状态")[0].props.onClick();
  app.render();
  for (const details of app.details()) details.open = false;
  app.edit(7);
  assert.equal(app.details().every(details => details.open), true);
  assert.equal(app.find("textarea", node => node.props.name === "rules")[0].props.value, '{"edited":true}');
  assert.equal(app.record("SourceEditor").key, editor.key);
  assert.equal(app.record("SourceEditor").instance, editor.instance);
  assert.equal(app.record("SourceSettings").instance, settings.instance);
  assert.equal(app.record("ImageCollector").instance, collector.instance);
  assert.equal(app.find("section")[0].props["data-preview"], "blob:already-collected");
  assert.equal(app.scrolls.length, 2);
  assert.equal(app.saves(), 0);
});

test("unknown source IDs are ignored and changing configured source keeps collector mounted", () => {
  const app = workspace();
  for (const id of [0, -1, 7.5, 999, NaN]) app.edit(id);
  assert.equal(app.record("SourceSettings").props.selectedSourceId, "");
  assert.equal(app.scrolls.length, 0);
  const collector = app.record("ImageCollector").instance;
  app.edit(7);
  const firstEditor = app.record("SourceEditor").instance;
  app.edit(8);
  assert.notEqual(app.record("SourceEditor").instance, firstEditor);
  assert.equal(app.record("ImageCollector").instance, collector);
  assert.equal(app.record("SourceSettings").key, null);
  assert.equal(app.record("ImageCollector").key, null);
  assert.equal(app.saves(), 0);
});

test("controlled settings dropdown updates its selection without navigation or automatic save", () => {
  const app = workspace();
  app.edit(7);
  app.find("select")[0].props.onChange({ target: { value: "8" } });
  app.render();
  assert.equal(app.record("SourceSettings").props.selectedSourceId, "8");
  assert.equal(app.find("input", node => node.props.name === "sourceId")[0].props.value, 8);
  app.find("select")[0].props.onChange({ target: { value: "" } });
  app.render();
  assert.equal(app.find("input", node => node.props.name === "sourceId")[0].props.value, "");
  assert.equal(app.saves(), 0);
});
