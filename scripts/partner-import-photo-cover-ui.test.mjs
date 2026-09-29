import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";

// Component events run with synthetic props and mocked hooks only. No image,
// database, browser, environment or network access occurs.
function fixture(options = {}) {
  let cursor = 0;
  let reducer;
  let actionState = { version: 1 };
  const slots = [];
  const context = vm.createContext({ URL, console });
  const mocks = {
    "react/jsx-runtime": jsxRuntime,
    "react": {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useEffect(callback) { callback(); },
      useActionState(nextReducer) { reducer = nextReducer; return [actionState, "/synthetic-action", false]; },
    },
    "next/link": { default: "a" },
    "./actions": { reviewPartnerDraft() { throw new Error("Unexpected action"); } },
    "./site-config.ts": { SITE_URL: "https://site.example" },
  };
  function load(relative) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const run = vm.runInContext("(function(exports, require) {" + output + "\n})", context);
    const exports = {};
    run(exports, name => {
      assert.ok(Object.hasOwn(mocks, name), "Unmocked import: " + name);
      return mocks[name];
    });
    return exports;
  }
  const helper = load("../src/lib/partner-import-photo-cover.ts");
  mocks["@/lib/partner-import-photo-cover"] = helper;
  mocks["@/data/locations"] = load("../src/data/locations.ts");
  const { DraftForm } = load("../src/app/adminzhangzhang/partner-import/DraftForm.tsx");
  const rawProps = {
    id: 1, version: 1, status: "pending", photos: ["synthetic-a.jpg", "synthetic-b.jpg"],
    postRevision: 0, baseRevision: 0, teacherId: null, photoCover: null,
    fields: { name: "Synthetic title", services: "Synthetic services", type: "钢琴" },
    ...options,
  };
  const props = vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify(rawProps)) + ")", context);
  if (options.onReview) props.onReview = options.onReview;
  if (options.onPreviewReadyChange) props.onPreviewReadyChange = options.onPreviewReadyChange;
  let tree;
  function render() {
    cursor = 0;
    tree = DraftForm(props);
    return tree;
  }
  function walk(value, result = []) {
    if (Array.isArray(value)) for (const item of value) walk(item, result);
    else if (value && typeof value === "object" && value.props) {
      result.push(value);
      walk(value.props.children, result);
    }
    return result;
  }
  const all = () => walk(tree);
  const find = predicate => {
    const result = all().find(predicate);
    assert.ok(result, "Missing UI element");
    return result;
  };
  const label = value => find(item => item.props["aria-label"] === value);
  const name = value => find(item => item.props.name === value);
  const button = value => find(item => item.type === "button" && item.props.value === value);
  const images = () => all().filter(item => item.type === "img");
  const preview = () => {
    find(item => item.type === "button" && item.props.children === "预览覆盖效果").props.onClick();
    render();
  };
  const enable = () => { label("用网站网址覆盖图片水印").props.onChange({ target: { checked: true } }); render(); };
  const loadImages = () => { for (const img of images()) img.props.onLoad(); render(); };
  render();
  return { render, all, label, name, button, images, preview, enable, loadImages, tree: () => tree, helper,
    submit: async form => { actionState = await reducer(actionState, form); render(); return actionState; } };
}

const savedCover = {
  text: "site.example", position: "bottom", align: "center", widthPercent: 100, heightPercent: 15,
};

test("coverage is optional and off previews explicitly use original authenticated images", () => {
  const f = fixture();
  assert.equal(f.label("用网站网址覆盖图片水印").props.checked, false);
  assert.equal(f.name("photoCover").props.value, "null");
  assert.equal(f.button("save").props.disabled, false);
  assert.equal(f.button("publish").props.disabled, true);
  for (const image of f.images()) {
    assert.match(image.props.src, /^\/adminzhangzhang\/partner-import\/photos\/1\/.+\?cover=off$/);
    assert.equal(image.props.referrerPolicy, "no-referrer");
  }
});

test("enabling requires explicit preview and every selected image to load before save or publish", () => {
  const f = fixture();
  f.enable();
  assert.equal(f.label("显示的网址").props.value, "site.example");
  assert.equal(f.button("save").props.disabled, true);
  assert.equal(f.name("confirmPublish").props.disabled, true);
  f.preview();
  assert.deepEqual(JSON.parse(f.name("photoCover").props.value), savedCover);
  const images = f.images();
  assert.ok(images.every(image => image.props.loading === "eager"));
  assert.ok(images.every(image => JSON.parse(decodeURIComponent(image.props.src.split("?cover=")[1])).text === "site.example"));
  images[0].props.onLoad(); f.render();
  assert.equal(f.button("save").props.disabled, true);
  images[1].props.onLoad(); f.render();
  assert.equal(f.button("save").props.disabled, false);
  assert.equal(f.button("publish").props.disabled, true);
  f.name("confirmPublish").props.onChange({ target: { checked: true } }); f.render();
  assert.equal(f.button("publish").props.disabled, false);
});

test("settings change clears confirmation, preserves last applied config and ignores stale image loads", () => {
  const f = fixture();
  f.enable(); f.preview(); f.loadImages();
  f.name("confirmPublish").props.onChange({ target: { checked: true } }); f.render();
  const oldImages = f.images();
  f.label("覆盖高度").props.onChange({ target: { value: "25" } }); f.render();
  assert.equal(f.name("confirmPublish").props.checked, false);
  assert.equal(f.button("save").props.disabled, true);
  assert.equal(JSON.parse(f.name("photoCover").props.value).heightPercent, 15);
  f.preview();
  for (const image of oldImages) image.props.onLoad();
  f.render();
  assert.equal(f.button("save").props.disabled, true);
  assert.equal(JSON.parse(f.name("photoCover").props.value).heightPercent, 25);
  f.loadImages();
  assert.equal(f.button("save").props.disabled, false);
  assert.equal(f.button("publish").props.disabled, true);
});

test("failed previews remain blocked, reject works, and closing coverage restores original images", () => {
  const f = fixture();
  f.enable(); f.preview();
  f.images()[0].props.onError(); f.images()[1].props.onLoad(); f.render();
  assert.equal(f.button("save").props.disabled, true);
  assert.match(f.all().find(item => item.props.role === "alert").props.children, /预览失败/);
  assert.equal(f.button("reject").props.disabled, undefined);
  let prevented = false;
  f.tree().props.onSubmit({ nativeEvent: { submitter: { getAttribute: () => "reject" } }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  f.tree().props.onSubmit({ nativeEvent: { submitter: { getAttribute: () => "save" } }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  f.label("用网站网址覆盖图片水印").props.onChange({ target: { checked: false } }); f.render();
  assert.equal(f.button("save").props.disabled, false);
  assert.equal(f.name("photoCover").props.value, "null");
  assert.ok(f.images().every(image => image.props.src.endsWith("?cover=off")));
});

test("retry creates fresh image instances even when the coverage settings stay the same", () => {
  const f = fixture();
  f.enable(); f.preview();
  const oldImages = f.images();
  f.preview();
  assert.notEqual(f.images()[0].key, oldImages[0].key);
  for (const image of oldImages) image.props.onLoad();
  f.render();
  assert.equal(f.button("save").props.disabled, true);
  f.loadImages();
  assert.equal(f.button("save").props.disabled, false);
});

test("selected photos govern preview readiness and changing selection clears confirmation", () => {
  const f = fixture();
  f.enable(); f.preview();
  f.images()[0].props.onLoad(); f.render();
  const choices = () => f.all().filter(item => item.props.name === "keepPhotos");
  choices()[1].props.onChange({ target: { checked: false } }); f.render();
  assert.equal(f.button("save").props.disabled, false);
  f.name("confirmPublish").props.onChange({ target: { checked: true } }); f.render();
  choices()[1].props.onChange({ target: { checked: true } }); f.render();
  assert.equal(f.name("confirmPublish").props.checked, false);
  assert.equal(f.button("save").props.disabled, true);
  choices()[0].props.onChange({ target: { checked: false } });
  choices()[1].props.onChange({ target: { checked: false } }); f.render();
  assert.equal(f.button("save").props.disabled, false);
});

test("invalid website text never becomes an applied preview or form payload", () => {
  const f = fixture();
  f.enable();
  f.label("显示的网址").props.onChange({ target: { value: '<svg onload="bad">' } }); f.render();
  f.preview();
  assert.equal(f.name("photoCover").props.value, "null");
  assert.equal(f.button("save").props.disabled, true);
  assert.match(f.all().find(item => item.props.role === "alert").props.children, /有效的网站/);
});

test("saved coverage reloads for private preview and completed drafts remain read only", () => {
  const f = fixture({ photoCover: savedCover });
  assert.equal(f.label("用网站网址覆盖图片水印").props.checked, true);
  assert.equal(f.button("save").props.disabled, true);
  f.loadImages();
  assert.equal(f.button("save").props.disabled, false);
  for (const status of ["published", "rejected"]) {
    const historical = fixture({ status, photoCover: savedCover });
    assert.ok(historical.all().filter(item => item.type === "fieldset").every(item => item.props.disabled));
    assert.equal(historical.all().filter(item => item.props.name === "intent").length, 0);
    assert.ok(historical.images().every(image => !image.props.src.endsWith("cover=off")));
  }
});

test("pending drafts without saved settings automatically preview the default coverage", () => {
  const f = fixture({ photoCover: undefined });
  assert.equal(f.label("用网站网址覆盖图片水印").props.checked, true);
  assert.deepEqual(JSON.parse(f.name("photoCover").props.value), savedCover);
  assert.ok(f.images().every(image => image.props.loading === "eager"));
  assert.ok(f.images().every(image => JSON.parse(decodeURIComponent(image.props.src.split("?cover=")[1])).heightPercent === 15));
  assert.equal(f.button("save").props.disabled, true);
  f.loadImages();
  assert.equal(f.button("save").props.disabled, false);
  assert.equal(f.button("publish").props.disabled, true);
});

test("explicitly disabled coverage and historical drafts without settings remain off", () => {
  for (const options of [{ photoCover: null }, { status: "published", photoCover: undefined }, { status: "rejected", photoCover: undefined }]) {
    const f = fixture(options);
    assert.equal(f.label("用网站网址覆盖图片水印").props.checked, false);
    assert.equal(f.name("photoCover").props.value, "null");
    assert.ok(f.images().every(image => image.props.src.endsWith("?cover=off")));
  }
});

test("saved customized coverage remains intact and manual price or contacts are not cleared", () => {
  const customCover = { ...savedCover, text: "custom.example", position: "top", align: "right", widthPercent: 50, heightPercent: 25 };
  const fields = { name: "Synthetic title", services: "Synthetic services", type: "钢琴", price: "Synthetic price", phone: "Synthetic phone", wechat: "Synthetic wechat", qq: "Synthetic QQ", otherContact: "Synthetic contact" };
  const f = fixture({ photoCover: customCover, fields });
  assert.deepEqual(JSON.parse(f.name("photoCover").props.value), customCover);
  for (const field of ["price", "phone", "wechat", "qq", "otherContact"]) assert.equal(f.name(field).props.value, fields[field]);
  assert.ok(f.all().some(item => item.type === "p" && typeof item.props.children === "string" && item.props.children.includes("请手动填写")));
});

test("assigned members reuse fields and stored coverage through their own private photo route", () => {
  const f = fixture({ mode: "team", status: "assigned", photoCover: savedCover });
  assert.equal(f.all().some(item => item.props.name === "photoCover"), false);
  assert.equal(f.all().some(item => item.props["aria-label"] === "用网站网址覆盖图片水印"), false);
  assert.equal(f.all().some(item => item.props.name === "confirmPublish"), false);
  assert.ok(f.images().every(image => /^\/team\/assigned\/1\/photos\/[^?]+$/.test(image.props.src)));
  assert.equal(f.button("save").props.disabled, true);
  f.loadImages();
  assert.equal(f.button("submit").props.disabled, false);
  assert.ok(f.all().filter(item => item.props.href).every(item => !item.props.href.startsWith("/admin")));
});

test("submitted member drafts are locked and returned drafts remain editable with review notes", () => {
  for (const status of ["submitted", "published"]) {
    const f = fixture({ mode: "team", status, photoCover: savedCover, teacherId: 42 });
    assert.ok(f.all().filter(item => item.type === "fieldset").every(item => item.props.disabled));
    assert.equal(f.all().filter(item => item.props.name === "intent").length, 0);
    assert.ok(f.all().filter(item => item.props.href).every(item => !item.props.href.startsWith("/admin")));
  }
  const returned = fixture({ mode: "team", status: "returned", reviewNote: "Synthetic review note" });
  assert.ok(returned.button("save"));
  assert.ok(returned.button("submit"));
  assert.match(JSON.stringify(returned.tree()), /Synthetic review note/);
});

test("member save continues editing; submit freezes locally and failed submissions remain editable", async () => {
  const calls = [];
  let result = { version: 2, message: "Saved" };
  const f = fixture({ mode: "team", status: "assigned", onReview: async (...args) => { calls.push(args); return result; } });
  const form = new FormData();
  form.set("intent", "save");
  await f.submit(form);
  assert.ok(f.button("submit"));
  result = { error: "Synthetic validation error" };
  form.set("intent", "submit");
  await f.submit(form);
  assert.ok(f.button("submit"));
  result = { version: 3, submitted: true, message: "Submitted" };
  await f.submit(form);
  assert.equal(f.all().filter(item => item.props.name === "intent").length, 0);
  assert.equal(calls[2][1], 2);
});

test("team mode without its server action never falls back to administrator mutation", async () => {
  const f = fixture({ mode: "team", status: "assigned" });
  const form = new FormData(); form.set("intent", "save");
  assert.match((await f.submit(form)).error, /无法保存/);
});

test("read-only final previews report readiness only after all covered photos load", () => {
  const readiness = [];
  const f = fixture({ status: "submitted", photoCover: savedCover, onPreviewReadyChange: ready => readiness.push(ready) });
  assert.equal(readiness.at(-1), false);
  f.images()[0].props.onLoad(); f.render();
  assert.equal(readiness.at(-1), false);
  f.images()[1].props.onLoad(); f.render();
  assert.equal(readiness.at(-1), true);
  f.images()[0].props.onError(); f.render();
  assert.equal(readiness.at(-1), false);
  f.images()[0].props.onLoad(); f.render();
  assert.equal(readiness.at(-1), true);
});

test("final readiness also waits for unmodified original photos and handles photo-free drafts", () => {
  const readiness = [];
  const f = fixture({ status: "submitted", photoCover: null, onPreviewReadyChange: ready => readiness.push(ready) });
  assert.equal(readiness.at(-1), false);
  assert.ok(f.images().every(image => image.props.loading === "eager"));
  f.loadImages();
  assert.equal(readiness.at(-1), true);
  const emptyReadiness = [];
  fixture({ status: "submitted", photos: [], photoCover: null, onPreviewReadyChange: ready => emptyReadiness.push(ready) });
  assert.equal(emptyReadiness.at(-1), true);
});

test("changing an applied photo preview invalidates final readiness and stale loads cannot restore it", () => {
  const readiness = [];
  const f = fixture({ photoCover: savedCover, onPreviewReadyChange: ready => readiness.push(ready) });
  f.loadImages();
  assert.equal(readiness.at(-1), true);
  const oldImages = f.images();
  f.label("覆盖高度").props.onChange({ target: { value: "25" } }); f.render();
  assert.equal(readiness.at(-1), false);
  f.preview();
  for (const image of oldImages) image.props.onLoad();
  f.render();
  assert.equal(readiness.at(-1), false);
  f.loadImages();
  assert.equal(readiness.at(-1), true);
});


test("draft city input resolves Shenzhen to Guangdong on blur in both member and admin editors", () => {
  for (const mode of ["team", "admin"]) {
    const f = fixture({ mode, status: mode === "team" ? "assigned" : "pending", photos: [],
      fields: { name: "Synthetic title", services: "Synthetic services", type: "钢琴", city: "", district: "" } });
    f.name("district").props.onChange({ target: { value: "深圳" } }); f.render();
    assert.equal(f.name("district").props.value, "深圳");
    f.name("district").props.onBlur({ target: { value: "深圳" } }); f.render();
    assert.equal(f.name("city").props.value, "广东省");
    assert.equal(f.name("district").props.value, "深圳市");
    assert.equal(f.name("name").props.value, "Synthetic title");
    assert.equal(f.name("services").props.value, "Synthetic services");
    const options = f.all().find(node => node.type === "datalist" && node.props.id === f.name("district").props.list);
    assert.ok(options.props.children.some(option => option.props.value === "深圳市"));
    assert.equal(f.name("city").props.required, undefined);
    assert.equal(f.name("district").props.required, undefined);
  }
});

test("province shorthand and pasted municipality districts use the ordinary form's location rules", () => {
  const f = fixture({ fields: { name: "Synthetic", services: "Synthetic", type: "钢琴", city: "", district: "" } });
  f.name("city").props.onChange({ target: { value: " 广东 " } }); f.render();
  f.name("city").props.onBlur({ target: { value: " 广东 " } }); f.render();
  assert.equal(f.name("city").props.value, "广东省");
  f.name("district").props.onChange({ target: { value: " 徐汇 " } }); f.render();
  f.name("district").props.onBlur({ target: { value: " 徐汇 " } }); f.render();
  assert.equal(f.name("city").props.value, "上海市");
  assert.equal(f.name("district").props.value, "徐汇区");
  const options = f.all().find(node => node.type === "datalist" && node.props.id === f.name("district").props.list);
  assert.ok(options.props.children.some(option => option.props.value === "徐汇区"));
  assert.equal(options.props.children.some(option => option.props.value === "深圳市"), false);
});

test("unrecognized or cleared locations stay editable without clearing other fields", () => {
  const f = fixture({ fields: { name: "Synthetic", services: "Synthetic", type: "钢琴", city: "广东省", district: "深圳市" } });
  for (const value of ["自定义地点", ""]) {
    f.name("district").props.onChange({ target: { value } }); f.render();
    f.name("district").props.onBlur({ target: { value } }); f.render();
    assert.equal(f.name("district").props.value, value);
    assert.equal(f.name("city").props.value, "广东省");
  }
  f.name("city").props.onChange({ target: { value: "" } }); f.render();
  f.name("city").props.onBlur({ target: { value: "" } }); f.render();
  assert.equal(f.name("city").props.value, "");
  assert.equal(f.name("name").props.value, "Synthetic");
});
