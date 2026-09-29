import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";

// Synthetic rows and in-memory server actions only. No real drafts, members,
// environment configuration, database or image files are accessed.
function loadSource(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
    return mocks[name];
  } });
  return exports;
}
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}
function words(element) {
  if (element === null || element === undefined || typeof element === "boolean") return "";
  if (typeof element !== "object") return String(element);
  return Array.isArray(element) ? element.map(words).join("") : words(element.props?.children);
}
const rows = ["pending", "pending", "ready", "assigned", "returned", "submitted", "published", "rejected"].map((status, index) => ({
  id: index + 1, version: 1, status, sourceName: "Synthetic source", createdLabel: "Synthetic date",
  teamUsername: ["assigned", "returned", "submitted"].includes(status) ? "Synthetic member" : null,
}));

function fixture({ teamAccounts = [{ id: 9, username: "Synthetic member" }], assignmentReady = true } = {}) {
  let cursor = 0;
  let actionCursor = 0;
  const slots = [];
  const states = [{}, {}, {}];
  const reducers = [];
  const pending = [false, false, false];
  let drafts = structuredClone(rows);
  let nextResult = { error: "Synthetic error" };
  const calls = [];
  const makeAction = name => async (_previous, form) => {
    calls.push([name, [...form.entries()]]);
    return nextResult;
  };
  const { DraftList } = loadSource("src/app/adminzhangzhang/partner-import/DraftList.tsx", {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useActionState(reducer) {
        const index = actionCursor++;
        reducers[index] = reducer;
        return [states[index], "/synthetic-action-" + index, pending[index]];
      },
    },
    "next/link": { default: props => {
      const clean = { ...props }; delete clean.prefetch; return createElement("a", clean);
    } },
    "next/navigation": { useRouter: () => ({ refresh() { calls.push(["refresh"]); } }) },
    "./actions": { deletePartnerDrafts: makeAction("delete") },
    "./assignment-actions": { approvePartnerDrafts: makeAction("approve"), assignPartnerDrafts: makeAction("assign") },
  });
  function render() {
    cursor = 0; actionCursor = 0;
    const element = DraftList({ drafts, emptyLabel: "Synthetic empty", teamAccounts, assignmentReady });
    const all = nodes(element);
    const $ = parseHtml(renderToStaticMarkup(element));
    const form = operation => all.find(node => node.type === "form" && node.props["data-operation"] === operation);
    return {
      all, $, form,
      button: text => all.find(node => node.type === "button" && words(node) === text),
      checkbox: id => all.find(node => node.type === "input" && node.props["aria-label"] === "选择草稿 #" + id),
      account: all.find(node => node.type === "select" && node.props.name === "teamAccountId"),
      tokens: operation => nodes(form(operation)).filter(node => node.type === "input" && node.props.name === "draft").map(node => node.props.value),
      prevented(operation, submitterName = "") {
        let prevented = false;
        form(operation).props.onSubmit({
          nativeEvent: { submitter: { getAttribute: () => submitterName } },
          preventDefault() { prevented = true; },
        });
        return prevented;
      },
    };
  }
  async function submit(operation) {
    const view = render();
    const form = view.form(operation);
    const data = new FormData();
    for (const node of nodes(form)) {
      if ((node.type === "input" || node.type === "select") && node.props.name) data.append(node.props.name, node.props.value);
    }
    const index = Number(form.props.action.slice(-1));
    pending[index] = true;
    try { states[index] = await reducers[index](states[index], data); }
    finally { pending[index] = false; }
  }
  return { render, submit, calls, setResult: value => { nextResult = value; },
    setDrafts: value => { drafts = value; }, setPending: index => { pending[index] = true; } };
}

test("workflow selection is limited to initial, ready and rejected drafts with controls outside links", () => {
  const view = fixture().render();
  for (const id of [1, 2, 3, 8]) assert.equal(view.checkbox(id).props.disabled, false);
  for (const id of [4, 5, 6, 7]) assert.equal(view.checkbox(id).props.disabled, true);
  assert.equal(view.$("form form, a input, a button, img").length, 0);
  assert.match(view.$.text(), /负责人：Synthetic member/);
  assert.ok(view.form("approve-1"));
  assert.equal(view.form("approve-3"), undefined);
});

test("batch approval uses only checked initial drafts and is independent of delete confirmation", async () => {
  const ui = fixture();
  ui.render().checkbox(1).props.onChange();
  ui.render().checkbox(2).props.onChange();
  let view = ui.render();
  assert.deepEqual(view.tokens("approve-selected"), ["1:1", "2:1"]);
  assert.equal(view.button("同意所选").props.disabled, false);
  assert.equal(view.prevented("approve-selected"), false);
  assert.equal(view.prevented("delete", "confirmDelete"), true);
  ui.setResult({ message: "Synthetic approved", updatedDraftIds: [1, 2] });
  await ui.submit("approve-selected");
  view = ui.render();
  assert.deepEqual(view.tokens("approve-selected"), []);
  assert.equal(view.checkbox(1).props.disabled, true);
  assert.deepEqual(ui.calls, [["approve", [["draft", "1:1"], ["draft", "2:1"]]], ["refresh"]]);
  ui.setDrafts(rows.map(row => row.id <= 2 ? { ...row, status: "ready", version: 2 } : row));
  assert.equal(ui.render().checkbox(1).props.disabled, false);
});

test("single approval sends only its row even when a different workflow row is selected", async () => {
  const ui = fixture();
  ui.render().checkbox(3).props.onChange();
  ui.setResult({ updatedDraftIds: [1], message: "Synthetic approved" });
  await ui.submit("approve-1");
  assert.deepEqual(ui.calls[0], ["approve", [["draft", "1:1"]]]);
  const view = ui.render();
  assert.deepEqual(view.tokens("assign-selected"), ["3:1"]);
  assert.equal(view.checkbox(3).props.checked, true);
});

test("assignment requires ready-only selection and an available team account, preserving selection on failure", async () => {
  const ui = fixture();
  ui.render().checkbox(3).props.onChange();
  let view = ui.render();
  assert.equal(view.button("分配所选").props.disabled, true);
  assert.equal(view.prevented("assign-selected"), true);
  view.account.props.onChange({ target: { value: "999" } });
  assert.equal(ui.render().button("分配所选").props.disabled, true);
  ui.render().account.props.onChange({ target: { value: "9" } });
  view = ui.render();
  assert.equal(view.button("分配所选").props.disabled, false);
  assert.equal(view.prevented("assign-selected"), false);
  assert.deepEqual(view.tokens("delete"), []);
  assert.equal(view.button("删除所选").props.disabled, true);
  ui.setResult({ error: "Synthetic unavailable member" });
  await ui.submit("assign-selected");
  view = ui.render();
  assert.deepEqual(view.tokens("assign-selected"), ["3:1"]);
  assert.match(view.$("[role=alert]").text(), /Synthetic unavailable member/);
  assert.deepEqual(ui.calls, [["assign", [["draft", "3:1"], ["teamAccountId", "9"]]]]);
  ui.setResult({ message: "Synthetic assigned", updatedDraftIds: [3] });
  await ui.submit("assign-selected");
  view = ui.render();
  assert.equal(view.checkbox(3).props.disabled, true);
  assert.deepEqual(view.tokens("assign-selected"), []);
  assert.equal(ui.calls.filter(call => call[0] === "refresh").length, 1);
});

test("mixed workflow selections cannot be approved, assigned or deleted by accident", () => {
  const ui = fixture();
  ui.render().checkbox(1).props.onChange();
  ui.render().checkbox(3).props.onChange();
  const view = ui.render();
  for (const text of ["同意所选", "分配所选", "删除所选"]) assert.equal(view.button(text).props.disabled, true);
  for (const operation of ["approve-selected", "assign-selected", "delete"]) {
    assert.deepEqual(view.tokens(operation), []);
    assert.equal(view.prevented(operation, "confirmDelete"), true);
  }
});

test("delete confirmation is scoped to its own explicit submit and selecting ready cancels it", () => {
  const ui = fixture();
  ui.render().checkbox(1).props.onChange();
  ui.render().button("删除所选").props.onClick();
  let view = ui.render();
  assert.equal(view.prevented("delete", "confirmDelete"), false);
  assert.equal(view.prevented("delete", ""), true);
  assert.equal(view.prevented("delete", "approve"), true);
  ui.render().checkbox(3).props.onChange();
  view = ui.render();
  assert.equal(view.button("确认删除 1 条"), undefined);
  assert.equal(view.prevented("delete", "confirmDelete"), true);
});

test("any pending operation disables all other actions and member choices", () => {
  for (const index of [0, 1, 2]) {
    const ui = fixture();
    ui.render().checkbox(1).props.onChange();
    ui.setPending(index);
    const view = ui.render();
    for (const node of view.all.filter(node => node.type === "button" || node.type === "select" || (node.type === "input" && node.props.type === "checkbox"))) {
      assert.equal(node.props.disabled, true);
    }
    for (const operation of ["approve-selected", "assign-selected", "delete", "approve-1"]) assert.equal(view.prevented(operation, "confirmDelete"), true);
  }
});

test("no active accounts keeps assignment unavailable and shows actionable guidance", () => {
  const ui = fixture({ teamAccounts: [] });
  ui.render().checkbox(3).props.onChange();
  const view = ui.render();
  assert.equal(view.account.props.disabled, true);
  assert.equal(view.button("分配所选").props.disabled, true);
  assert.match(view.$.text(), /暂无可用团队成员/);
});

class PartnerImportError extends Error {}
function actionFixture({ authorized = true, fail = false, knownError = null, refreshFail = false } = {}) {
  const calls = [];
  const core = name => async form => {
    calls.push([name, [...form.entries()]]);
    if (fail) throw new Error("SYNTHETIC_PRIVATE_DETAILS");
    if (knownError) throw new PartnerImportError(knownError);
    return { message: "Synthetic success", draftIds: [1, 2] };
  };
  const api = loadSource("src/app/adminzhangzhang/partner-import/assignment-actions.ts", {
    "next/cache": { revalidatePath: path => { calls.push(["revalidate", path]); if (refreshFail) throw new Error("SYNTHETIC_PRIVATE_CACHE_FAILURE"); } },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("authorize");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/partner-import": { PartnerImportError },
    "@/lib/partner-import-assignment": { approveImportDrafts: core("approve"), assignImportDrafts: core("assign") },
  });
  return { api, calls };
}

test("both administrative actions authorize before any mutation", async () => {
  for (const name of ["approvePartnerDrafts", "assignPartnerDrafts"]) {
    const f = actionFixture({ authorized: false });
    await assert.rejects(f.api[name]({}, new FormData()), /UNAUTHORIZED/);
    assert.deepEqual(f.calls, ["authorize"]);
  }
});

test("approval and assignment expose only safe result metadata and refresh affected admin/team pages", async () => {
  for (const name of ["approvePartnerDrafts", "assignPartnerDrafts"]) {
    const f = actionFixture();
    const form = new FormData();
    form.append("draft", "1:1"); form.append("draft", "2:1");
    if (name === "assignPartnerDrafts") form.set("teamAccountId", "9");
    const result = await f.api[name]({}, form);
    assert.equal(f.calls[0], "authorize");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { message: "Synthetic success", updatedDraftIds: [1, 2] });
    assert.deepEqual(f.calls.filter(call => Array.isArray(call) && call[0] === "revalidate").map(call => call[1]), [
      "/adminzhangzhang/partner-import", "/team", "/team/assigned", "/adminzhangzhang/submissions",
      "/adminzhangzhang/partner-import/drafts/1", "/adminzhangzhang/partner-import/drafts/2",
    ]);
  }
});

test("assignment exceptions never expose core error details or refresh failed mutations", async () => {
  for (const name of ["approvePartnerDrafts", "assignPartnerDrafts"]) {
    const f = actionFixture({ fail: true });
    const result = await f.api[name]({}, new FormData());
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE"), false);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(Object.keys(result), ["error"]);
  }
});

test("disabled assignment mode preserves legacy selection and deletion without approval/member controls", () => {
  const ui = fixture({ assignmentReady: false });
  let view = ui.render();
  assert.equal(view.form("approve-selected"), undefined);
  assert.equal(view.form("assign-selected"), undefined);
  assert.equal(view.form("approve-1"), undefined);
  assert.equal(view.account, undefined);
  assert.equal(view.checkbox(1).props.disabled, false);
  assert.equal(view.checkbox(8).props.disabled, false);
  for (const id of [3, 4, 5, 6, 7]) assert.equal(view.checkbox(id).props.disabled, true);
  assert.equal(view.$.text().includes("负责人"), false);
  view.checkbox(1).props.onChange();
  view = ui.render();
  assert.equal(view.button("删除所选").props.disabled, false);
  view.button("删除所选").props.onClick();
  view = ui.render();
  assert.ok(view.button("确认删除 1 条"));
  assert.equal(view.prevented("delete", "confirmDelete"), false);
  assert.deepEqual(view.tokens("delete"), ["1:1"]);
});

test("known fixed business reasons reach the UI without hiding the failing draft", async () => {
  const reason = "草稿 #2：同一原帖的其他版本 #3 已在“待分配”，请继续处理该版本。";
  for (const name of ["approvePartnerDrafts", "assignPartnerDrafts"]) {
    const f = actionFixture({ knownError: reason });
    const result = await f.api[name]({}, new FormData());
    assert.equal(result.error, reason);
    assert.deepEqual(Object.keys(result), ["error"]);
    assert.equal(f.calls.length, 2);
  }
});

test("cache refresh failures preserve committed success and tell the user to refresh without repeating the mutation", async () => {
  for (const name of ["approvePartnerDrafts", "assignPartnerDrafts"]) {
    const f = actionFixture({ refreshFail: true });
    const result = await f.api[name]({}, new FormData());
    assert.equal(result.error, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(result.updatedDraftIds)), [1, 2]);
    assert.match(result.message, /Synthetic success/);
    assert.match(result.message, /手动刷新/);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE/);
    assert.equal(f.calls.filter(call => Array.isArray(call) && ["approve", "assign"].includes(call[0])).length, 1);
    assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === "revalidate").length, 6);
  }
});
