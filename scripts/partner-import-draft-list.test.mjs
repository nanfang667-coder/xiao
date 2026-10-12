import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";

// Only source code and synthetic fixtures are read. No browser, environment,
// database, uploads or partner network requests are used by these tests.
function loadSource(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URLSearchParams, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
    return mocks[name];
  } });
  return exports;
}

const rows = [
  { id: 1, version: 2, status: "pending", sourceName: "Synthetic source", createdLabel: "Synthetic date" },
  { id: 2, version: 3, status: "rejected", sourceName: "Synthetic source", createdLabel: "Synthetic date" },
  { id: 3, version: 4, status: "published", sourceName: "Synthetic source", createdLabel: "Synthetic date" },
  { id: 4, version: 5, status: "unknown", sourceName: "Synthetic source", createdLabel: "Synthetic date" },
];

function nodes(element) {
  if (element === null || element === undefined || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}

function words(element) {
  if (element === null || element === undefined || typeof element === "boolean") return "";
  if (typeof element !== "object") return String(element);
  return Array.isArray(element) ? element.map(words).join("") : words(element.props?.children);
}

function fixture() {
  const stateSlots = [];
  let cursor = 0;
  let actionState = {};
  let pending = false;
  let drafts = structuredClone(rows);
  const action = Symbol("deletePartnerDrafts");
  const { DraftList } = loadSource("src/app/adminzhangzhang/partner-import/DraftList.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "react": {
      useState(initial) {
        const index = cursor++;
        if (!(index in stateSlots)) stateSlots[index] = typeof initial === "function" ? initial() : initial;
        return [stateSlots[index], value => {
          stateSlots[index] = typeof value === "function" ? value(stateSlots[index]) : value;
        }];
      },
      useActionState(received) {
        return received === action ? [actionState, "/synthetic-delete", pending] : [{}, "/synthetic-update", false];
      },
    },
    "next/link": { default: props => { const attributes = { ...props }; delete attributes.prefetch; return createElement("a", attributes); } },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "./actions": { deletePartnerDrafts: action },
    "./assignment-actions": { approvePartnerDrafts: async () => ({}), assignPartnerDrafts: async () => ({}) },
  });
  function render() {
    cursor = 0;
    const element = DraftList({ drafts, emptyLabel: "Synthetic empty list" });
    const all = nodes(element);
    const $ = parseHtml(renderToStaticMarkup(element));
    return {
      element, all, $,
      button: text => all.find(node => node.type === "button" && words(node) === text),
      checkbox: id => all.find(node => node.type === "input" && node.props["aria-label"] === "选择草稿 #" + id),
      selectAll: all.find(node => node.type === "input" && node.props.type === "checkbox" && !node.props["aria-label"]),
      submitPrevented() {
        let prevented = false;
        all.find(node => node.type === "form" && node.props["data-operation"] === "delete").props.onSubmit({
          nativeEvent: { submitter: { getAttribute: () => "confirmDelete" } },
          preventDefault() { prevented = true; },
        });
        return prevented;
      },
      tokens: () => $('form[data-operation="delete"] input[name=draft]').map((_index, item) => $(item).val()).get(),
    };
  }
  return {
    render,
    setDrafts: value => { drafts = value; },
    setPending: value => { pending = value; },
    setResult: value => { actionState = value; },
  };
}

test("only pending and rejected drafts are selectable and links do not wrap checkboxes", () => {
  const view = fixture().render();
  assert.equal(view.checkbox(1).props.disabled, false);
  assert.equal(view.checkbox(2).props.disabled, false);
  assert.equal(view.checkbox(3).props.disabled, true);
  assert.equal(view.checkbox(4).props.disabled, true);
  assert.equal(view.button("删除所选").props.disabled, true);
  assert.equal(view.$("a input").length, 0);
  assert.equal(view.$("form form").length, 0);
  assert.deepEqual(view.tokens(), []);
  assert.equal(view.submitPrevented(), true);
});

test("select all affects eligible drafts on this page, and toggling a row invalidates confirmation", () => {
  const ui = fixture();
  ui.render().selectAll.props.onChange();
  let view = ui.render();
  assert.deepEqual(view.tokens(), ["1:2", "2:3"]);
  assert.equal(view.selectAll.props.checked, true);
  view.button("删除所选").props.onClick();
  assert.ok(ui.render().button("确认删除 2 条"));
  ui.render().checkbox(1).props.onChange();
  view = ui.render();
  assert.deepEqual(view.tokens(), ["2:3"]);
  assert.equal(view.selectAll.props.checked, false);
  assert.equal(view.button("确认删除 1 条"), undefined);
  const control = {};
  view.selectAll.props.ref(control);
  assert.equal(control.indeterminate, true);
  view.selectAll.props.onChange();
  ui.render().selectAll.props.onChange();
  assert.deepEqual(ui.render().tokens(), []);
});

test("deletion requires a second explicit submit and cancel preserves selection", () => {
  const ui = fixture();
  ui.render().checkbox(1).props.onChange();
  let view = ui.render();
  assert.equal(view.submitPrevented(), true);
  view.button("删除所选").props.onClick();
  view = ui.render();
  assert.equal(view.submitPrevented(), false);
  const confirm = view.button("确认删除 1 条");
  assert.equal(confirm.props.type, "submit");
  assert.equal(confirm.props.name, "confirmDelete");
  assert.equal(confirm.props.value, "yes");
  assert.deepEqual(view.tokens(), ["1:2"]);
  assert.deepEqual(view.$('form[data-operation="delete"] input[name]').map((_index, item) => view.$(item).attr("name")).get(), ["draft"]);
  view.button("取消").props.onClick();
  view = ui.render();
  assert.equal(view.submitPrevented(), true);
  assert.equal(view.button("确认删除 1 条"), undefined);
  assert.deepEqual(view.tokens(), ["1:2"]);
});

test("pending deletion locks selection, confirmation and repeated submit", () => {
  const ui = fixture();
  ui.render().selectAll.props.onChange();
  ui.render().button("删除所选").props.onClick();
  ui.setPending(true);
  const view = ui.render();
  for (const control of view.all.filter(node => node.type === "button" || (node.type === "input" && node.props.type === "checkbox"))) {
    assert.equal(control.props.disabled, true);
  }
  assert.ok(view.button("正在删除…"));
  assert.equal(view.submitPrevented(), true);
});

test("refreshed versions, published statuses and missing rows cannot inherit an old selection", () => {
  for (const transform of [
    input => input.map(row => row.id === 1 ? { ...row, version: row.version + 1 } : row),
    input => input.map(row => row.id === 1 ? { ...row, status: "published" } : row),
    input => input.filter(row => row.id !== 1),
  ]) {
    const ui = fixture();
    ui.render().checkbox(1).props.onChange();
    ui.render().button("删除所选").props.onClick();
    ui.setDrafts(transform(structuredClone(rows)));
    const view = ui.render();
    assert.deepEqual(view.tokens(), []);
    assert.equal(view.submitPrevented(), true);
    assert.equal(view.$("button[name=confirmDelete]").length, 0);
  }
});

test("a changed selection cannot inherit confirmation for an older batch", () => {
  const ui = fixture();
  ui.render().selectAll.props.onChange();
  ui.render().button("删除所选").props.onClick();
  ui.setDrafts(rows.map(row => row.id === 1 ? { ...row, version: 9 } : row));
  const view = ui.render();
  assert.deepEqual(view.tokens(), ["2:3"]);
  assert.equal(view.$("button[name=confirmDelete]").length, 0);
  assert.equal(view.submitPrevented(), true);
});

test("successful deletion removes selected rows and payload even before refreshed props arrive", () => {
  const ui = fixture();
  ui.render().selectAll.props.onChange();
  ui.render().button("删除所选").props.onClick();
  ui.setResult({ deletedDraftIds: [1, 2], message: "Synthetic success" });
  const view = ui.render();
  assert.equal(view.checkbox(1), undefined);
  assert.equal(view.checkbox(2), undefined);
  assert.deepEqual(view.tokens(), []);
  assert.equal(view.$("button[name=confirmDelete]").length, 0);
  assert.match(view.$.text(), /Synthetic success/);
});

test("failure leaves selection available, and list rendering never includes post contents or photos", () => {
  const ui = fixture();
  ui.setDrafts(rows.map(row => ({ ...row, fields: "SYNTHETIC_PRIVATE_BODY", photos: "SYNTHETIC_PRIVATE_PHOTO" })));
  ui.render().checkbox(1).props.onChange();
  ui.setResult({ error: "Synthetic fixed error" });
  const view = ui.render();
  assert.deepEqual(view.tokens(), ["1:2"]);
  assert.equal(view.$("[role=alert]").text(), "Synthetic fixed error");
  assert.equal(view.$.html().includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(view.$("img").length, 0);
});

async function pageFixture({ status = "pending", page = "1", jobsPage = "1", jobTotal = 0, authorized = true, assignmentReady = true } = {}) {
  const calls = [];
  const draftList = () => null;
  const jobList = () => null;
  const sources = { findMany: async args => { calls.push(["sources", args]); return []; } };
  const jobs = {
    count: async () => { calls.push("countJobs"); return jobTotal; },
    findMany: async args => {
      calls.push(["jobs", args]);
      return jobTotal ? [{ id: "synthetic-job", createdAt: new Date("2026-01-01T00:00:00Z"), source: { name: "Synthetic source" }, _count: { items: 20 } }] : [];
    },
  };
  const drafts = {
    count: async args => { calls.push(["countDrafts", args]); return 40; },
    findMany: async args => {
      calls.push(["drafts", args]);
      if (!assignmentReady) assert.equal(Object.hasOwn(args.select, "assignedAccount"), false);
      return [{ ...rows[0], createdAt: new Date("2026-01-01T00:00:00Z"), post: { source: { name: "Synthetic source" } } }];
    },
  };
  const { default: Page } = loadSource("src/app/adminzhangzhang/partner-import/page.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: props => createElement("a", props) },
    "@/lib/auth": { requireAdmin: async () => { calls.push("requireAdmin"); if (!authorized) throw new Error("UNAUTHORIZED"); } },
    "@/lib/prisma": { prisma: { partnerImportSource: sources, partnerImportJob: jobs, partnerImportDraft: drafts, teamAccount: { findMany: async args => { assert.equal(assignmentReady, true); calls.push(["teamAccounts", args]); return [{ id: 7, username: "Synthetic member" }]; } } } },
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => { calls.push("assignmentReady"); return assignmentReady; } },
    "@/lib/pagination": { parsePage: value => Number(value) || 1 },
    "@/lib/partner-import-parser": { DEFAULT_PARTNER_IMPORT_RULES: {} },
    "./ImportForms": { ImportForms: () => null },
    "./TransferUpload": { TransferUpload: () => null },
    "./DraftList": { DraftList: draftList },
    "./JobList": { JobList: jobList },
  });
  const render = () => Page({ searchParams: Promise.resolve({ status, page, jobsPage }) });
  if (!authorized) {
    await assert.rejects(render, /UNAUTHORIZED/);
    return { calls };
  }
  const element = await render();
  return { calls, element, list: nodes(element).find(node => node.type === draftList), jobList: nodes(element).find(node => node.type === jobList) };
}

test("page authenticates first and resets selection identity when page or status changes", async () => {
  const first = await pageFixture();
  const second = await pageFixture({ page: "2" });
  const all = await pageFixture({ status: "all" });
  assert.equal(first.calls[0], "requireAdmin");
  assert.notEqual(first.list.key, second.list.key);
  assert.notEqual(first.list.key, all.list.key);
  const unauthorized = await pageFixture({ authorized: false });
  assert.deepEqual(unauthorized.calls, ["requireAdmin"]);
});

test("list query and client props contain only identifiers, versions, status and display metadata", async () => {
  const { calls, list } = await pageFixture();
  const query = calls.find(call => Array.isArray(call) && call[0] === "drafts")[1];
  assert.equal(query.take, 20);
  assert.equal(query.select.version, true);
  assert.equal(Object.hasOwn(query.select, "fields"), false);
  assert.equal(Object.hasOwn(query.select, "photos"), false);
  assert.deepEqual(Object.keys(list.props.drafts[0]).sort(), ["createdLabel", "id", "sourceName", "status", "teamUsername", "version"]);
});

test("job list client receives only display metadata and task pagination clamps after deletion", async () => {
  const before = await pageFixture({ jobsPage: "3", jobTotal: 21 });
  const after = await pageFixture({ jobsPage: "3", jobTotal: 20 });
  const beforeQuery = before.calls.find(call => Array.isArray(call) && call[0] === "jobs")[1];
  const afterQuery = after.calls.find(call => Array.isArray(call) && call[0] === "jobs")[1];
  assert.equal(beforeQuery.take, 10);
  assert.equal(beforeQuery.skip, 20);
  assert.equal(afterQuery.skip, 10);
  assert.notEqual(before.jobList.key, after.jobList.key);
  assert.deepEqual(Object.keys(after.jobList.props.jobs[0]).sort(), ["createdLabel", "id", "itemCount", "sourceName"]);
  assert.equal(Object.hasOwn(afterQuery.select, "listUrl"), false);
  assert.equal(Object.hasOwn(afterQuery.select, "rules"), false);
});

test("workflow status filters and member choices only query active metadata", async () => {
  for (const status of ["ready", "assigned", "returned", "submitted"]) {
    const { calls, list } = await pageFixture({ status });
    assert.equal(calls.find(call => Array.isArray(call) && call[0] === "countDrafts")[1].where.status, status);
    assert.match(list.key, new RegExp("^" + status + ":"));
    const query = calls.find(call => Array.isArray(call) && call[0] === "teamAccounts")[1];
    assert.deepEqual(JSON.parse(JSON.stringify(query)), {
      where: { isActive: true, site: { isActive: true } },
      orderBy: { username: "asc" }, select: { id: true, username: true },
    });
    assert.deepEqual(Object.keys(list.props.teamAccounts[0]).sort(), ["id", "username"]);
    const draftQuery = calls.find(call => Array.isArray(call) && call[0] === "drafts")[1];
    assert.deepEqual(Object.keys(draftQuery.select.assignedAccount.select), ["username"]);
  }
});

test("assignment-disabled management page avoids new relations and member queries while preserving legacy routes", async () => {
  const { calls, element, list } = await pageFixture({ assignmentReady: false, status: "ready" });
  assert.deepEqual(calls.slice(0, 2), ["requireAdmin", "assignmentReady"]);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "teamAccounts"), false);
  const query = calls.find(call => Array.isArray(call) && call[0] === "drafts")[1];
  assert.equal(Object.hasOwn(query.select, "assignedAccount"), false);
  assert.equal(Object.hasOwn(query.select, "teamAccountId"), false);
  assert.equal(query.where.status, "pending");
  assert.equal(list.props.assignmentReady, false);
  assert.deepEqual(Array.from(list.props.teamAccounts), []);
  const all = nodes(element);
  const states = all.filter(node => node.props?.["aria-label"] === "草稿状态").flatMap(node => nodes(node));
  const links = states.filter(node => node.props?.href).map(node => node.props.href);
  assert.equal(links.length, 4);
  assert.ok(links.every(href => !/status=(ready|assigned|returned|submitted)/.test(href)));
  assert.match(words(element), /团队分配功能尚未启用，当前可继续导入和审核/);
});
