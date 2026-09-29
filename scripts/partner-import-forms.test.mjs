import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";

const origin = "https://partner.example";
const listUrl = origin + "/?page=2";
const imageOrigin = "https://images.example";
const newerOrigin = "https://new-images.example";

function render(options = {}) {
  const props = {
    sources: [{ id: 1, name: "Synthetic source", origin, rules: "{}", imageOrigins: JSON.stringify(options.allowed ?? [imageOrigin]) }],
    defaultRules: "{}",
  };
  const check = { sourceId: 1, listUrl, origins: [imageOrigin], sampled: 3, failed: 0, photoCount: 9, ...options.check };
  const actionSymbols = Object.fromEntries(["savePartnerSource", "startPartnerImport", "detectPartnerImageOrigins", "allowPartnerImageOrigins"].map(name => [name, Symbol(name)]));
  const states = new Map([
    [actionSymbols.detectPartnerImageOrigins, { imageOriginCheck: check }],
    [actionSymbols.allowPartnerImageOrigins, { imageOriginsSaved: { sourceId: 1, listUrl }, message: "Saved" }],
  ]);
  let stateIndex = 0;
  const values = ["1", options.activeSource ?? "1", options.listUrl ?? listUrl];
  const mocks = {
    "react/jsx-runtime": jsxRuntime,
    "react": {
      useState: initial => [stateIndex < values.length ? values[stateIndex++] : typeof initial === "function" ? initial() : initial, () => {}],
      useEffect: () => {},
      useActionState: action => [states.get(action) ?? {}, "/synthetic-action", false],
    },
    "next/link": { default: props => createElement("a", props) },
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "./actions": actionSymbols,
  };
  const source = fs.readFileSync(new URL("../src/app/adminzhangzhang/partner-import/ImportForms.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) { assert.ok(Object.hasOwn(mocks, name)); return mocks[name]; } });
  const element = exports.ImportForms(props);
  const editorKey = element.props.children[1].props.children.at(-1).key;
  return { $: parseHtml(renderToStaticMarkup(element)), editorKey };
}

test("same-page previous success cannot disable approval for a newly detected domain", () => {
  const { $ } = render({ check: { origins: [newerOrigin] } });
  assert.equal($("button[name=allowImageOrigins]").attr("disabled"), undefined);
  assert.match($("button[name=allowImageOrigins]").text(), /允许这些图片域名并保存/);
});

test("approval is shown as saved only when every detected domain is currently configured", () => {
  const saved = render();
  assert.notEqual(saved.$("button[name=allowImageOrigins]").attr("disabled"), undefined);
  assert.match(saved.$("button[name=allowImageOrigins]").text(), /已保存/);
  const incomplete = render({ check: { origins: [imageOrigin, newerOrigin] } });
  assert.equal(incomplete.$("button[name=allowImageOrigins]").attr("disabled"), undefined);
  const removed = render({ allowed: [] });
  assert.equal(removed.$("button[name=allowImageOrigins]").attr("disabled"), undefined);
});

test("switching list URL or source hides the previous detection approval form", () => {
  for (const options of [{ listUrl: origin + "/?page=3" }, { activeSource: "2" }]) {
    const { $ } = render(options);
    assert.equal($("button[name=allowImageOrigins]").length, 0);
  }
});

test("changing confirmed image origins does not remount the whole source editor", () => {
  const before = render({ allowed: [] });
  const after = render({ allowed: [imageOrigin] });
  assert.equal(before.editorKey, "1");
  assert.equal(before.editorKey, after.editorKey);
});
