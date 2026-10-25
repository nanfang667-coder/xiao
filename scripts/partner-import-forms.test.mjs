import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";
import { DISCUZ_FIRST_POST_PHOTO_SELECTOR as discuzPhotoSelector } from "../src/lib/partner-discuz-image-rules.ts";

const component = fs.readFileSync(new URL("../src/app/adminzhangzhang/partner-import/ImportForms.tsx", import.meta.url), "utf8");

function render(selected = "", sources = [], controlled = {}) {
  let index = 0;
  const mocks = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState: initial => [index++ === 0 ? selected : typeof initial === "function" ? initial() : initial, () => {}],
      useActionState: () => [{}, "/synthetic-source-action", false],
    },
    "./actions": { savePartnerSource() {} },
    "@/lib/partner-discuz-image-rules": { DISCUZ_FIRST_POST_PHOTO_SELECTOR: discuzPhotoSelector },
  };
  const output = ts.transpileModule(component, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; } });
  return parseHtml(renderToStaticMarkup(exports.SourceSettings({ sources, defaultRules: '{"synthetic":true}', ...controlled })));
}

test("source settings only retain configuration and default JSON rules", () => {
  const $ = render();
  assert.equal($("details[open]").length, 1);
  assert.equal($("input[name=name]").length, 1);
  assert.equal($("input[name=origin]").attr("type"), "url");
  assert.equal($("textarea[name=imageOrigins]").length, 1);
  assert.equal($("textarea[name=rules]").text(), '{"synthetic":true}');
  assert.match($("details").text(), /nextPageSelector/);
  assert.match($("details").text(), /pageUrlTemplate/);
  assert.match($("button").text(), /添加来源/);
  assert.doesNotMatch(component, /startPartnerImport|detectPartnerImageOrigins|allowPartnerImageOrigins|useRouter|jobId|\/jobs\/|TransferUpload/);
});

test("existing source keeps editable image origins, name and rules with immutable origin", () => {
  const $ = render("7", [{ id: 7, name: "合成来源", origin: "https://partner.example", imageOrigins: '["https://images.example"]', rules: '{"custom":true}' }]);
  assert.equal($("input[name=sourceId]").attr("value"), "7");
  assert.equal($("input[name=name]").attr("value"), "合成来源");
  assert.notEqual($("input[name=origin]").attr("readonly"), undefined);
  assert.equal($("textarea[name=imageOrigins]").text(), "https://images.example");
  assert.equal($("textarea[name=rules]").text(), '{"custom":true}');
  assert.equal($("form details[open]").length, 1);
  assert.equal($("select option[value=7]").text(), "合成来源 · https://partner.example");
  assert.match($("button").text(), /保存来源配置/);
});

test("controlled source selection overrides local state and exposes that source's JSON", () => {
  const sources = [
    { id: 7, name: "第一来源", origin: "https://first.example", rules: '{"first":true}', imageOrigins: "[]" },
    { id: 8, name: "第二来源", origin: "https://second.example", rules: '{"second":true}', imageOrigins: "[]" },
  ];
  const $ = render("7", sources, { selectedSourceId: "8", onSelectSource() {} });
  assert.equal($("input[name=sourceId]").attr("value"), "8");
  assert.equal($("textarea[name=rules]").text(), '{"second":true}');
  assert.equal($("form details[open]").length, 1);
  assert.equal($("select option[value=8]").text(), "第二来源 · https://second.example");
});

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}

function sourceEditor({ rules, defaultRules = '{"postLinkSelector":"article h2 a"}', pending = false }) {
  const hooks = ["7"];
  let cursor = 0, saves = 0;
  const savePartnerSource = () => { saves += 1; };
  const mocks = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
        return [hooks[index], next => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }];
      },
      useActionState: () => [{}, savePartnerSource, pending],
    },
    "./actions": { savePartnerSource },
    "@/lib/partner-discuz-image-rules": { DISCUZ_FIRST_POST_PHOTO_SELECTOR: discuzPhotoSelector },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(component, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require(name) { assert.ok(Object.hasOwn(mocks, name)); return mocks[name]; } });
  const settings = exports.SourceSettings({ defaultRules, sources: [{ id: 7, name: "合成来源", origin: "https://partner.example", imageOrigins: '["https://images.example"]', rules }] });
  const editor = nodes(settings, node => typeof node.type === "function" && node.type.name === "SourceEditor")[0];
  function renderEditor() { cursor = 1; return editor.type(editor.props); }
  const find = (type, predicate = () => true) => nodes(renderEditor(), node => node.type === type && predicate(node));
  function origins() {
    const field = nodes(renderEditor(), node => typeof node.type === "function" && node.type.name === "ImageOriginsField")[0];
    cursor = 3;
    return { key: field.key, textarea: nodes(field.type(field.props), node => node.type === "textarea")[0] };
  }
  return {
    find, origins,
    rules: () => find("textarea", node => node.props.name === "rules")[0].props.value,
    restore: () => find("button", node => node.props.type === "button")[0].props.onClick(),
    applyDiscuz: () => find("button", node => node.props.children === "应用 Discuz 首帖图片规则")[0].props.onClick(),
    html: () => renderToStaticMarkup(renderEditor()),
    saves: () => saves,
    submit: () => renderEditor().props.action(),
  };
}

test("restoring only the post-link selector preserves edited source and all image/pagination rules until explicit save", () => {
  const configured = { postLinkSelector: ".old-post-link", photoSelector: ".custom-photos img", nextPageSelector: "a.next-page",
    pageUrlTemplate: "https://partner.example/list?page={page}", fields: { title: "h1", city: ".city" }, extras: [1, false, null] };
  const app = sourceEditor({ rules: JSON.stringify(configured), defaultRules: '{"postLinkSelector":"article h2 a","photoSelector":"img.default"}' });
  app.find("input", node => node.props.name === "name")[0].props.onChange({ target: { value: "编辑后的来源名称" } });
  const before = app.origins();
  before.textarea.props.onChange({ target: { value: "https://edited-images.example\nhttps://second-images.example" } });
  assert.equal(app.find("button", node => node.props.type === "button")[0].props.type, "button");
  app.restore();
  assert.deepEqual(JSON.parse(app.rules()), { ...configured, postLinkSelector: "article h2 a" });
  assert.equal(app.find("input", node => node.props.name === "name")[0].props.value, "编辑后的来源名称");
  assert.equal(app.find("input", node => node.props.name === "origin")[0].props.value, "https://partner.example");
  assert.equal(app.origins().textarea.props.value, "https://edited-images.example\nhttps://second-images.example");
  assert.equal(app.origins().key, before.key);
  assert.equal(app.saves(), 0);
  assert.match(app.html(), /仅替换链接选择器，请点击保存来源配置后生效/);
  app.submit();
  assert.equal(app.saves(), 1);
});

test("invalid or non-object JSON is preserved verbatim with an inline error and no save", () => {
  for (const rules of ["{broken", "", "[]", "null", '"custom"', "42", "true"]) {
    const app = sourceEditor({ rules });
    app.restore();
    assert.equal(app.rules(), rules);
    assert.equal(app.saves(), 0);
    assert.match(app.html(), /role="alert"/);
    assert.match(app.html(), /未修改任何配置/);
  }
});

test("missing or unusable default selectors leave the complete existing rule text unchanged", () => {
  const rules = '{ "photoSelector": ".photos img", "postLinkSelector": ".keep-this", "fields": {"title":"h1"} }';
  for (const defaultRules of ["{broken", "null", "[]", "{}", '{"postLinkSelector":""}', '{"postLinkSelector":"  "}', '{"postLinkSelector":null}', '{"postLinkSelector":42}']) {
    const app = sourceEditor({ rules, defaultRules });
    app.restore();
    assert.equal(app.rules(), rules);
    assert.equal(app.saves(), 0);
    assert.match(app.html(), /默认帖子链接规则不可用/);
  }
});

test("restore control is disabled during source saving and rule edits clear stale feedback", () => {
  const pending = sourceEditor({ rules: "{}", pending: true });
  assert.equal(pending.find("button", node => node.props.type === "button")[0].props.disabled, true);
  const app = sourceEditor({ rules: "{broken" });
  app.restore();
  assert.match(app.html(), /role="alert"/);
  app.find("textarea", node => node.props.name === "rules")[0].props.onChange({ target: { value: "{}" } });
  assert.doesNotMatch(app.html(), /role="alert"/);
});

test("applying Discuz first-post photos only replaces the photo selector and waits for explicit save", () => {
  const configured = { postLinkSelector: ".keep-post-links", photoSelector: ".old-photos img",
    nextPageSelector: "a.keep-next", pageUrlTemplate: "/forum.php?fid=2&page={page}",
    fields: { name: ".keep-name" }, extras: [1, null, false] };
  const app = sourceEditor({ rules: JSON.stringify(configured) });
  app.find("input", node => node.props.name === "name")[0].props.onChange({ target: { value: "未保存的新名称" } });
  const before = app.origins();
  before.textarea.props.onChange({ target: { value: "https://edited-images.example" } });
  const button = app.find("button", node => node.props.children === "应用 Discuz 首帖图片规则")[0];
  assert.equal(button.props.type, "button");
  app.applyDiscuz();
  assert.deepEqual(JSON.parse(app.rules()), { ...configured, photoSelector: discuzPhotoSelector });
  assert.equal(app.find("input", node => node.props.name === "name")[0].props.value, "未保存的新名称");
  assert.equal(app.find("input", node => node.props.name === "origin")[0].props.value, "https://partner.example");
  assert.equal(app.origins().textarea.props.value, "https://edited-images.example");
  assert.equal(app.origins().key, before.key);
  assert.equal(app.saves(), 0);
  assert.match(app.html(), /已应用 Discuz 首帖图片规则，请点击保存来源配置后生效/);
  assert.match(app.html(), /只获取首帖正文和附件，适用于帖子区初始隐藏的论坛主题/);
  app.submit();
  assert.equal(app.saves(), 1);
});

test("Discuz first-post preset preserves malformed or non-object JSON and performs no save", () => {
  for (const rules of ["{broken", "", "[]", "null", '"custom"', "42", "true"]) {
    const app = sourceEditor({ rules });
    app.applyDiscuz();
    assert.equal(app.rules(), rules);
    assert.equal(app.saves(), 0);
    assert.match(app.html(), /role="alert"/);
    assert.match(app.html(), /未修改任何配置/);
  }
});

test("Discuz preset is disabled while saving and can be reapplied without changing other rules", () => {
  const pending = sourceEditor({ rules: "{}", pending: true });
  assert.equal(pending.find("button", node => node.props.children === "应用 Discuz 首帖图片规则")[0].props.disabled, true);
  const app = sourceEditor({ rules: '{"postLinkSelector":"a.keep"}' });
  app.applyDiscuz();
  const applied = app.rules();
  app.applyDiscuz();
  assert.equal(app.rules(), applied);
  assert.equal(app.saves(), 0);
  app.find("textarea", node => node.props.name === "rules")[0].props.onChange({ target: { value: "{}" } });
  assert.doesNotMatch(app.html(), /已应用 Discuz/);
});
