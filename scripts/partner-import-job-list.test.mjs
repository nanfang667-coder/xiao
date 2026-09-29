import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";

// All records and actions are synthetic. No real job, database, file or network
// mutation is performed by this interaction harness.
const jobs = [
  { id: "synthetic-job-one", sourceName: "Synthetic source A", createdLabel: "Synthetic date A", itemCount: 20 },
  { id: "synthetic-job-two", sourceName: "Synthetic source B", createdLabel: "Synthetic date B", itemCount: 12 },
];

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

function fixture() {
  let cursor = 0;
  const slots = [];
  let actionState = {};
  let pending = false;
  let reducer;
  let nextResult = { error: "Synthetic unconfigured error" };
  let records = structuredClone(jobs);
  const calls = [];
  const mocks = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useActionState(received) { reducer = received; return [actionState, "/synthetic-job-delete", pending]; },
    },
    "next/link": { default: props => {
      const clean = { ...props };
      delete clean.prefetch;
      return createElement("a", clean);
    } },
    "next/navigation": { useRouter: () => ({ refresh() { calls.push(["refresh"]); } }) },
    "./actions": { deletePartnerImportJob: async form => {
      calls.push(["delete", [...form.entries()]]);
      if (typeof nextResult === "function") return nextResult();
      return nextResult;
    } },
  };
  const source = fs.readFileSync(new URL("../src/app/adminzhangzhang/partner-import/JobList.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
    return mocks[name];
  } });
  function render() {
    cursor = 0;
    const element = exports.JobList({ jobs: records });
    const all = nodes(element);
    const $ = parseHtml(renderToStaticMarkup(element));
    return {
      all, $, element,
      remove(id) {
        const row = records.find(item => item.id === id);
        return all.find(item => item.type === "button" && item.props["aria-label"] === `删除任务记录：${row.sourceName}，${row.createdLabel}`);
      },
      button(label) { return all.find(item => item.type === "button" && words(item) === label); },
      submitPrevented() {
        const form = all.find(item => item.type === "form");
        let prevented = false;
        form.props.onSubmit({ preventDefault() { prevented = true; } });
        return prevented;
      },
    };
  }
  async function submit(id, confirmed = true) {
    const form = new FormData();
    form.set("jobId", id);
    if (confirmed) form.set("confirmDelete", "yes");
    pending = true;
    try { actionState = await reducer(actionState, form); }
    finally { pending = false; }
  }
  return { render, submit, calls, setResult: result => { nextResult = result; }, setRecords: value => { records = value; } };
}

test("each job has a separate delete button and progress links contain no controls or private content", () => {
  const ui = fixture();
  ui.setRecords(jobs.map(job => ({ ...job, fields: "SYNTHETIC_PRIVATE_FIELDS", photos: ["SYNTHETIC_PRIVATE_PHOTO"] })));
  const view = ui.render();
  for (const job of jobs) {
    assert.ok(view.remove(job.id));
    assert.equal(view.remove(job.id).props.type, "button");
    assert.equal(view.remove(job.id).props["aria-expanded"], false);
  }
  assert.equal(view.$("a button, a input, img, form").length, 0);
  assert.equal(view.$("a").length, 2);
  assert.equal(view.$.html().includes("SYNTHETIC_PRIVATE"), false);
  assert.deepEqual(ui.calls, []);
});

test("delete opens one inline confirmation, cancel performs no mutation, and payload names are narrow", () => {
  const ui = fixture();
  ui.render().remove(jobs[0].id).props.onClick();
  let view = ui.render();
  assert.equal(view.$("form").length, 1);
  assert.equal(view.$("input[name=jobId]").val(), jobs[0].id);
  assert.equal(view.button("确认删除记录").props.name, "confirmDelete");
  assert.equal(view.button("确认删除记录").props.value, "yes");
  assert.match(view.$("form").text(), /待审帖子、图片及已发布帖子都会保留/);
  assert.match(view.$("form").text(), /未完成的条目将不再继续导入/);
  assert.equal(view.submitPrevented(), false);
  view.remove(jobs[1].id).props.onClick();
  view = ui.render();
  assert.equal(view.$("form").length, 1);
  assert.equal(view.$("input[name=jobId]").val(), jobs[1].id);
  view.button("取消").props.onClick();
  assert.equal(ui.render().$("form").length, 0);
  assert.deepEqual(ui.calls, []);
});

test("unconfirmed and stale row submissions never call the server action", async () => {
  const ui = fixture();
  ui.render();
  await ui.submit(jobs[0].id);
  ui.render().remove(jobs[0].id).props.onClick();
  ui.render();
  await ui.submit(jobs[0].id, false);
  ui.render().remove(jobs[1].id).props.onClick();
  ui.render();
  await ui.submit(jobs[0].id);
  assert.deepEqual(ui.calls, []);
});

test("pending deletion disables every delete and confirmation button and blocks repeated submit", async () => {
  const ui = fixture();
  let resolve;
  ui.setResult(() => new Promise(done => { resolve = done; }));
  ui.render().remove(jobs[0].id).props.onClick();
  ui.render();
  const response = ui.submit(jobs[0].id);
  const view = ui.render();
  assert.ok(view.button("正在删除…"));
  assert.equal(view.submitPrevented(), true);
  for (const item of view.all.filter(node => node.type === "button")) assert.equal(item.props.disabled, true);
  resolve({ deletedJobId: jobs[0].id, message: "Synthetic success" });
  await response;
});

test("successful deletion hides the row before refreshed props arrive and refreshes the count", async () => {
  const ui = fixture();
  ui.render().remove(jobs[0].id).props.onClick(); ui.render();
  ui.setResult({ deletedJobId: jobs[0].id, message: "Synthetic success" });
  await ui.submit(jobs[0].id);
  let view = ui.render();
  assert.equal(view.remove(jobs[0].id), undefined);
  assert.ok(view.remove(jobs[1].id));
  assert.equal(view.$("form").length, 0);
  assert.match(view.$("[role=status]").text(), /Synthetic success/);
  assert.deepEqual(ui.calls, [["delete", [["jobId", jobs[0].id], ["confirmDelete", "yes"]]], ["refresh"]]);
  view.remove(jobs[1].id).props.onClick(); ui.render();
  ui.setResult({ error: "Synthetic processing refusal" });
  await ui.submit(jobs[1].id);
  view = ui.render();
  assert.equal(view.remove(jobs[0].id), undefined);
  assert.ok(view.remove(jobs[1].id));
  assert.equal(view.$("[role=alert]").text(), "Synthetic processing refusal");
  assert.equal(ui.calls.filter(item => item[0] === "refresh").length, 1);
});

test("failure retains the task and confirmation; unexpected exceptions show only a fixed error", async () => {
  for (const result of [
    { error: "Synthetic processing refusal" },
    () => { throw new Error("SYNTHETIC_PRIVATE_DETAILS"); },
    { deletedJobId: "wrong-job", message: "Unexpected success" },
  ]) {
    const ui = fixture();
    ui.render().remove(jobs[0].id).props.onClick(); ui.render();
    ui.setResult(result);
    await ui.submit(jobs[0].id);
    const view = ui.render();
    assert.ok(view.remove(jobs[0].id));
    assert.ok(view.button("确认删除记录"));
    assert.ok(view.$("[role=alert]").text());
    assert.equal(view.$.html().includes("SYNTHETIC_PRIVATE_DETAILS"), false);
    assert.equal(ui.calls.filter(item => item[0] === "refresh").length, 0);
  }
});

test("consecutive successful deletions stay hidden and show the empty state", async () => {
  const ui = fixture();
  for (const job of jobs) {
    ui.render().remove(job.id).props.onClick(); ui.render();
    ui.setResult({ deletedJobId: job.id, message: "Synthetic success" });
    await ui.submit(job.id);
  }
  const view = ui.render();
  assert.equal(view.$("a").length, 0);
  assert.equal(view.$("button").length, 0);
  assert.match(view.$.text(), /还没有导入任务/);
});
