import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  });
  assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, FormData, URL, Error,
    require(name) {
      assert.ok(name in mocks, "Unmocked dependency: " + name);
      return mocks[name];
    },
  });
  return exports;
}

const id = "c123456789012345678901234";
const input = load("src/lib/promotion-channel-input.ts");
const plain = value => JSON.parse(JSON.stringify(value));
function form(fields = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const fields = { name: "GP77 推广", code: "GP77", hostname: "https://www.gp77.top/" };

function actions({ authorized = true, failure } = {}) {
  const calls = [];
  const mutations = [];
  const refreshed = [];
  const mutate = operation => async query => {
    assert.equal(calls[0], "authorize");
    calls.push(operation);
    mutations.push(plain(query));
    if (failure) throw failure;
    return { id };
  };
  const api = load("src/app/adminzhangzhang/channels/actions.ts", {
    "next/cache": { revalidatePath: path => refreshed.push(path) },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("authorize");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/prisma": { prisma: { promotionChannel: { create: mutate("create"), update: mutate("update") } } },
    "@/lib/promotion-channel-input": input,
  });
  return { api, calls, mutations, refreshed };
}

test("every channel mutation checks admin authorization before parsing or touching the database", async () => {
  for (const name of ["createPromotionChannel", "updatePromotionChannel", "setPromotionChannelActive"]) {
    const fixture = actions({ authorized: false });
    const args = name === "createPromotionChannel" ? [{}, null] : [null, {}, null];
    await assert.rejects(fixture.api[name](...args), /UNAUTHORIZED/);
    assert.deepEqual(fixture.calls, ["authorize"]);
    assert.deepEqual(fixture.refreshed, []);
  }
});

test("create stores normalized channel fields and ignores submitted user referral or state fields", async () => {
  const fixture = actions();
  const result = await fixture.api.createPromotionChannel({}, form({ ...fields, referralCode: "6KZ", userId: "40", isActive: "false" }));
  assert.ok(result.success);
  assert.deepEqual(fixture.mutations, [{ data: { name: "GP77 推广", hostname: "gp77.top", code: "gp77" }, select: { id: true } }]);
  assert.deepEqual(fixture.refreshed, ["/adminzhangzhang/channels"]);
});

test("invalid names, domains, codes, file fields and non-form data never reach a write", async () => {
  const invalid = [
    { ...fields, name: " ".repeat(3) },
    { ...fields, name: "x".repeat(81) },
    { ...fields, code: "bad/path" },
    { ...fields, code: "x".repeat(33) },
    { ...fields, hostname: "gp77.top/path" },
    { ...fields, hostname: "gp77.top?ref=6KZ" },
    { ...fields, hostname: new Blob(["gp77.top"]) },
  ].map(form);
  invalid.push(null, { get: () => "spoofed" });
  for (const data of invalid) {
    const fixture = actions();
    const result = await fixture.api.createPromotionChannel({}, data);
    assert.ok(result.error);
    assert.deepEqual(fixture.mutations, []);
    assert.deepEqual(fixture.refreshed, []);
  }
});

test("edit changes only the name and domain, preserving the permanent tracking code", async () => {
  const fixture = actions();
  const result = await fixture.api.updatePromotionChannel(id, {}, form({ name: "新名称", hostname: "second.top", code: "replacement", isActive: "false" }));
  assert.ok(result.success);
  assert.deepEqual(fixture.mutations, [{ where: { id }, data: { name: "新名称", hostname: "second.top" }, select: { id: true } }]);
});

test("activation uses an explicit desired state so repeated submissions cannot invert it", async () => {
  const fixture = actions();
  for (const desired of ["false", "false", "true"]) {
    const result = await fixture.api.setPromotionChannelActive(id, {}, form({ isActive: desired, code: "replacement" }));
    assert.ok(result.success);
  }
  assert.deepEqual(fixture.mutations.map(query => query.data), [{ isActive: false }, { isActive: false }, { isActive: true }]);
  for (const query of fixture.mutations) assert.deepEqual(query.where, { id });
});

test("invalid channel identifiers and activation values cannot mutate any channel", async () => {
  for (const badId of [null, 42, "", "c".repeat(1000), "../gp77"]) {
    const fixture = actions();
    assert.ok((await fixture.api.updatePromotionChannel(badId, {}, form(fields))).error);
    assert.ok((await fixture.api.setPromotionChannelActive(badId, {}, form({ isActive: "true" }))).error);
    assert.deepEqual(fixture.mutations, []);
  }
  for (const value of ["", "on", "TRUE", new Blob(["true"])]) {
    const fixture = actions();
    assert.ok((await fixture.api.setPromotionChannelActive(id, {}, form({ isActive: value }))).error);
    assert.deepEqual(fixture.mutations, []);
  }
});

test("duplicate, missing record and missing schema failures are actionable without exposing database details", async () => {
  for (const [code, message] of [["P2002", /已存在/], ["P2025", /不存在/], ["P2021", /数据库更新/], ["P1001", /保存失败/]]) {
    for (const operation of ["createPromotionChannel", "updatePromotionChannel", "setPromotionChannelActive"]) {
      const fixture = actions({ failure: { code, message: "SENSITIVE_DATABASE_ENDPOINT" } });
      const data = operation === "setPromotionChannelActive" ? form({ isActive: "false" }) : form(fields);
      const args = operation === "createPromotionChannel" ? [{}, data] : [id, {}, data];
      const result = await fixture.api[operation](...args);
      assert.match(result.error, message);
      assert.doesNotMatch(JSON.stringify(result), /SENSITIVE_DATABASE_ENDPOINT/);
      assert.deepEqual(fixture.refreshed, []);
    }
  }
});

function clientForms({ state = {}, pending = false } = {}) {
  return load("src/app/adminzhangzhang/channels/ChannelForms.tsx", {
    "react/jsx-runtime": jsx,
    react: { useActionState: () => [state, () => {}, pending], useState: initial => [initial, () => {}], useId: () => "target-url" },
    "./actions": { createPromotionChannel() {}, updatePromotionChannel() {}, setPromotionChannelActive() {} },
  });
}

const channel = { id, name: "GP77 推广", code: "gp77", hostname: "gp77.top", isActive: true, todayNewVisitors: 2, last24HourVisitors: 8, totalVisitors: 11, visitCount: 19 };
function page({ authorized = true, rows = [channel], failure } = {}) {
  const calls = [];
  const api = load("src/app/adminzhangzhang/channels/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: ({ children, ...attributes }) => React.createElement("a", attributes, children) },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("authorize");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/promotion-channel-stats": { getPromotionChannelStats: async () => {
      assert.equal(calls[0], "authorize");
      calls.push("stats");
      if (failure) throw failure;
      return rows;
    } },
    "@/lib/site-config": { SITE_URL: "https://main.example" },
    "./ChannelForms": clientForms(),
  });
  return { Page: api.default, calls };
}

test("channel page authorizes before loading statistics and renders each distinct metric", async () => {
  const denied = page({ authorized: false });
  await assert.rejects(denied.Page(), /UNAUTHORIZED/);
  assert.deepEqual(denied.calls, ["authorize"]);
  const fixture = page();
  const html = renderToStaticMarkup(await fixture.Page());
  for (const count of [2, 8, 11, 19]) assert.match(html, new RegExp(`>${count}</dd>`));
  assert.match(html, /北京时间/);
  assert.match(html, /不能相加/);
  assert.match(html, /不代表注册人数/);
  assert.match(html, /value="https:\/\/main\.example\/go\/gp77"/);
  assert.match(html, /readonly=""/i);
  assert.doesNotMatch(html, /href="[^"]*\/go\//);
  assert.doesNotMatch(html, /href="https?:\/\/gp77\.top/);
});

test("empty and uninitialized databases have distinct states and unexpected errors are not swallowed", async () => {
  const empty = renderToStaticMarkup(await page({ rows: [] }).Page());
  assert.match(empty, /还没有渠道/);
  assert.match(empty, /创建渠道/);
  const missing = renderToStaticMarkup(await page({ failure: { code: "P2021" } }).Page());
  assert.match(missing, /尚未完成数据库更新/);
  assert.doesNotMatch(missing, /<form/);
  await assert.rejects(page({ failure: new Error("UNEXPECTED") }).Page(), /UNEXPECTED/);
});

test("client forms surface errors and disable pending submission controls", () => {
  const { CreateChannelForm, EditChannelForm, ChannelStatusForm } = clientForms({ state: { error: "渠道标识已存在" }, pending: true });
  for (const [Component, props] of [[CreateChannelForm, {}], [EditChannelForm, { channel }], [ChannelStatusForm, { id, isActive: true }]]) {
    const html = renderToStaticMarkup(React.createElement(Component, props));
    assert.match(html, /role="alert"/);
    assert.match(html, /渠道标识已存在/);
    assert.match(html, /<button[^>]*disabled=""/);
  }
  const editing = renderToStaticMarkup(React.createElement(EditChannelForm, { channel }));
  assert.doesNotMatch(editing, /name="code"/);
  const status = renderToStaticMarkup(React.createElement(ChannelStatusForm, { id, isActive: true }));
  assert.match(status, /name="isActive" value="false"/);
  assert.match(status, /已有统计保留/);
});
