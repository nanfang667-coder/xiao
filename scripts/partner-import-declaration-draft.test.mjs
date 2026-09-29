import * as coverApi from "../src/lib/partner-import-photo-cover.ts";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// All page data is fictional; no environment files, live database, uploads or network are used.
function load(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
      return mocks[name];
    },
  });
  return exports;
}

const storedFields = {
  name: "虚构标题", type: "钢琴", city: "虚构市", district: "虚构区", price: "虚构价格",
  services: "虚构服务\n声明信息\n虚构网站声明",
  courseNotes: "虚构说明\n声明信息：虚构附加声明",
  age: null, phone: "fictional-contact", wechat: "", qq: null, otherContact: null, address: null,
};
const photoKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg";

function fixture({ status = "pending", authorized = true, fields = storedFields, submission = null, assignmentReady = true } = {}) {
  const calls = [];
  const queries = [];
  const draft = {
    id: 1, status, fields: JSON.stringify(fields), photos: JSON.stringify([photoKey]), submission,
    version: 2, baseRevision: 0, createdAt: new Date("2026-01-01T00:00:00Z"),
    post: { revision: 0, teacherId: null, source: { name: "虚构合作方" } },
  };
  const original = JSON.stringify(draft);
  const element = (type, props) => ({ type, props });
  const api = load("src/app/adminzhangzhang/partner-import/drafts/[id]/page.tsx", {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "next/link": { default: "Link", __esModule: true },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("auth");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/prisma": { prisma: { partnerImportDraft: {
      findUnique: async args => { calls.push("findUnique"); queries.push(args); return draft; },
      update: async () => { throw new Error("Page must not update data"); },
      updateMany: async () => { throw new Error("Page must not update data"); },
    } } },
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => { calls.push("assignmentReady"); return assignmentReady; } },
    "@/lib/partner-import-declarations": load("src/lib/partner-import-declarations.ts", {}),
    "@/lib/partner-import-photo-cover": coverApi,
    "../../DraftForm": { DraftForm: "DraftForm" },
    "../../FinalReviewPanel": { AssignedFinalReview: "AssignedFinalReview" },
  });
  return { api, draft, original, calls, queries };
}

function findForm(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "DraftForm") return value.props;
  for (const child of Object.values(value)) {
    const found = findForm(child);
    if (found) return found;
  }
  return null;
}

test("opening an existing pending draft removes declaration text from editable fields without writing stored data", async () => {
  const f = fixture();
  const tree = await f.api.default({ params: Promise.resolve({ id: "1" }) });
  const form = findForm(tree);
  assert.ok(form);
  assert.equal(form.fields.services, "虚构服务");
  assert.equal(form.fields.courseNotes, "虚构说明");
  assert.equal(form.fields.name, storedFields.name);
  assert.deepEqual(Array.from(form.photos), [photoKey]);
  assert.equal(form.version, 2);
  assert.equal(JSON.stringify(f.draft), f.original);
  assert.deepEqual(f.calls, ["auth", "assignmentReady", "findUnique"]);
});

test("published and rejected history retains its stored text and photo references", async () => {
  for (const status of ["published", "rejected"]) {
    const f = fixture({ status });
    const form = findForm(await f.api.default({ params: Promise.resolve({ id: "1" }) }));
    assert.ok(form);
    assert.equal(form.fields.services, storedFields.services);
    assert.equal(form.fields.courseNotes, storedFields.courseNotes);
    assert.deepEqual(Array.from(form.photos), [photoKey]);
    assert.equal(JSON.stringify(f.draft), f.original);
    assert.deepEqual(f.calls, ["auth", "assignmentReady", "findUnique"]);
  }
});

test("pending fields made empty by declaration removal remain empty for subsequent validation", async () => {
  const f = fixture({ fields: { ...storedFields, services: "声明信息\n虚构声明", phone: "声明信息：虚构联系声明" } });
  const form = findForm(await f.api.default({ params: Promise.resolve({ id: "1" }) }));
  assert.equal(form.fields.services, "");
  assert.equal(form.fields.phone, "");
  assert.equal(JSON.stringify(f.draft), f.original);
});

test("draft page authenticates before reading records or route parameters", async () => {
  const f = fixture({ authorized: false });
  await assert.rejects(f.api.default({
    params: { then() { throw new Error("Route read before authentication"); } },
  }), /UNAUTHORIZED/);
  assert.deepEqual(f.calls, ["auth"]);
});

test("saved cover settings are passed to the draft form without becoming editable text or writing data", async () => {
  const cover = { text: "site.example", position: "bottom", align: "right", widthPercent: 50, heightPercent: 15 };
  for (const status of ["pending", "published", "rejected"]) {
    const f = fixture({ status, fields: { ...storedFields, _photoCover: cover } });
    const form = findForm(await f.api.default({ params: Promise.resolve({ id: "1" }) }));
    assert.deepEqual(form.photoCover, cover);
    assert.equal(Object.hasOwn(form.fields, "_photoCover"), false);
    assert.equal(JSON.stringify(f.draft), f.original);
  }
});
test("invalid saved cover blocks review instead of silently publishing uncovered photos", async () => {
  const f = fixture({ fields: { ...storedFields, _photoCover: { invalid: true } } });
  const tree = await f.api.default({ params: Promise.resolve({ id: "1" }) });
  assert.equal(findForm(tree), null);
  assert.equal(tree.props.role, "alert");
  assert.equal(JSON.stringify(f.draft), f.original);
});

test("only pending drafts with missing cover settings get an in-memory default", async () => {
  const pending = fixture();
  const draftForm = findForm(await pending.api.default({ params: Promise.resolve({ id: "1" }) }));
  assert.deepEqual(draftForm.photoCover, coverApi.DEFAULT_PARTNER_PHOTO_COVER);
  assert.equal(JSON.stringify(pending.draft), pending.original);
  for (const status of ["pending", "published", "rejected"]) {
    const off = fixture({ status, fields: { ...storedFields, _photoCover: null } });
    assert.equal(findForm(await off.api.default({ params: Promise.resolve({ id: "1" }) })).photoCover, null);
    assert.equal(JSON.stringify(off.draft), off.original);
  }
  for (const status of ["published", "rejected"]) {
    const history = fixture({ status });
    assert.equal(findForm(await history.api.default({ params: Promise.resolve({ id: "1" }) })).photoCover, null);
    assert.equal(JSON.stringify(history.draft), history.original);
  }
});
test("opening a draft preserves manually saved pricing and every contact field", async () => {
  const manual = { price: "手填价格", phone: "manual-phone", wechat: "manual-wechat", qq: "10001", otherContact: "manual-contact" };
  const f = fixture({ fields: { ...storedFields, ...manual } });
  const form = findForm(await f.api.default({ params: Promise.resolve({ id: "1" }) }));
  for (const [key, value] of Object.entries(manual)) assert.equal(form.fields[key], value);
  assert.equal(JSON.stringify(f.draft), f.original);
});

test("submitted drafts use the shared final-preview wrapper instead of independent forms", async () => {
  const f = fixture({ status: "submitted", submission: { id: 11, reviewNote: null } });
  const tree = await f.api.default({ params: Promise.resolve({ id: "1" }) });
  function collect(value) {
    if (!value || typeof value !== "object") return [];
    return [value, ...Object.values(value).flatMap(collect)];
  }
  const elements = collect(tree);
  const wrapper = elements.find(value => value.type === "AssignedFinalReview");
  assert.ok(wrapper);
  assert.equal(wrapper.props.id, 1);
  assert.equal(wrapper.props.version, 2);
  assert.equal(wrapper.props.submissionId, 11);
  assert.equal(wrapper.props.status, "submitted");
  assert.deepEqual(Array.from(wrapper.props.photos), [photoKey]);
  assert.equal(findForm(tree), null);
  assert.equal(elements.some(value => value.type === "FinalReviewPanel"), false);
  assert.equal(JSON.stringify(f.draft), f.original);
});

test("disabled assignment mode uses an explicit legacy-only draft select and retains manual review", async () => {
  const f = fixture({ assignmentReady: false });
  const tree = await f.api.default({ params: Promise.resolve({ id: "1" }) });
  const form = findForm(tree);
  assert.ok(form);
  assert.equal(form.status, "pending");
  assert.equal(form.fields.name, storedFields.name);
  assert.deepEqual(f.calls, ["auth", "assignmentReady", "findUnique"]);
  assert.equal(f.queries.length, 1);
  assert.equal(Object.hasOwn(f.queries[0], "include"), false);
  assert.deepEqual(Object.keys(f.queries[0].select).sort(), ["baseRevision", "createdAt", "fields", "id", "photos", "post", "status", "version"]);
  assert.deepEqual(Object.keys(f.queries[0].select.post.select).sort(), ["revision", "source", "teacherId"]);
  assert.equal(Object.hasOwn(f.queries[0].select, "assignedAccount"), false);
  assert.equal(Object.hasOwn(f.queries[0].select, "submission"), false);
  assert.equal(form.reviewNote, undefined);
  assert.match(JSON.stringify(tree), /团队分配功能尚未启用，当前可继续导入和审核/);
  assert.equal(JSON.stringify(f.draft), f.original);
});

test("enabled assignment details request only the two required relation projections", async () => {
  const f = fixture();
  await f.api.default({ params: Promise.resolve({ id: "1" }) });
  assert.deepEqual(Object.keys(f.queries[0].select.assignedAccount.select), ["username"]);
  assert.deepEqual(Object.keys(f.queries[0].select.submission.select).sort(), ["id", "reviewNote"]);
});
