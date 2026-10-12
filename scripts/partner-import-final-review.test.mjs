import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(file, mocks) {
  mocks = { "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => true, requirePartnerImportAssignmentReady: async () => {} }, ...mocks };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; } });
  return exports;
}
class PartnerImportError extends Error {}
function fixture({ authorized = true, error, publish = true } = {}) {
  const calls = [];
  const api = load("src/app/adminzhangzhang/partner-import/final-review-actions.ts", {
    "next/cache": { revalidatePath: (...args) => calls.push(["refresh", ...args]) },
    "@/lib/auth": { requireAdmin: async () => { calls.push(["auth"]); if (!authorized) throw new Error("DENIED"); } },
    "@/lib/partner-import": { PartnerImportError },
    "@/lib/partner-import-assignment": { reviewAssignedImportDraft: async (...args) => {
      calls.push(["review", ...args]);
      if (error) throw error;
      return { message: publish ? "Published" : "Returned", draftId: 7, ...(publish ? { teacherId: 99 } : {}) };
    } },
  });
  return { api, calls };
}
function form(intent = "approve") {
  const data = new FormData(); data.set("intent", intent);
  data.set("reviewNote", "Synthetic note"); return data;
}
test("final review authenticates before validation or mutation and requires a valid review intent", async () => {
  const denied = fixture({ authorized: false });
  await assert.rejects(denied.api.finalizeAssignedImport(2, 8, {}, form()), /DENIED/);
  assert.deepEqual(denied.calls, [["auth"]]);
  for (const data of [form("unknown"), form("")]) {
    const f = fixture();
    assert.ok((await f.api.finalizeAssignedImport(2, 8, {}, data)).error);
    assert.deepEqual(f.calls, [["auth"]]);
  }
});
test("final review binds the reviewed version and refreshes public pages only after publication", async () => {
  for (const publish of [true, false]) {
    const f = fixture({ publish });
    const intent = publish ? "approve" : "return";
    const result = await f.api.finalizeAssignedImport(2, 8, {}, form(intent));
    assert.deepEqual(f.calls.slice(0, 2), [["auth"], ["review", 2, intent, "Synthetic note", 8]]);
    assert.equal(result.version, 9);
    assert.equal(f.calls.some(call => call[0] === "refresh" && call[1] === "/"), publish);
    assert.ok(f.calls.some(call => call[1] === "/team/assigned/7"));
    assert.ok(f.calls.some(call => call[1] === "/adminzhangzhang/partner-import/drafts/7"));
  }
});
test("final review errors never expose unexpected private details or refresh as success", async () => {
  for (const error of [new Error("SYNTHETIC_PRIVATE_DETAILS"), new PartnerImportError("请刷新后重新审查。")]) {
    const f = fixture({ error });
    const result = await f.api.finalizeAssignedImport(2, 8, {}, form());
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE_DETAILS"), false);
    assert.equal(f.calls.some(call => call[0] === "refresh"), false);
  }
});
test("ordinary submission approval and rejection cannot bypass imported draft review or remove its photos", async () => {
  const unexpected = () => { throw new Error("Unexpected mutation"); };
  const submission = { id: 2, status: "pending", partnerImportDraftId: 7, photos: '["synthetic-private.jpg"]' };
  const tx = { teacherSubmission: { findUnique: async () => submission, updateMany: unexpected }, teacher: { create: unexpected } };
  const api = load("src/app/adminzhangzhang/submissions/actions.ts", {
    "next/cache": { revalidatePath: unexpected },
    "@/lib/auth": { requireAdmin: async () => {} },
    "@/lib/prisma": { prisma: { ...tx, $transaction: async callback => callback(tx) } },
    "@/lib/uploaded-photos": { deleteUploadedPhotos: unexpected },
  });
  await assert.rejects(api.approveTeacherSubmission(2), /导入稿终审页/);
  await assert.rejects(api.rejectTeacherSubmission(2, new FormData()), /导入稿终审页/);
});
function panelFixture() {
  let cursor = 0, dirty = false, pending = false, actionState = {}, previewReady;
  const slots = [];
  const api = load("src/app/adminzhangzhang/partner-import/FinalReviewPanel.tsx", {
    "react/jsx-runtime": jsx,
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => {
          const next = typeof value === "function" ? value(slots[index]) : value;
          if (next !== slots[index]) { slots[index] = next; dirty = true; }
        }];
      },
      useActionState: () => [actionState, "/synthetic-finalize", pending],
    },
    "./DraftForm": { DraftForm: "DraftForm" },
    "./final-review-actions": { finalizeAssignedImport: () => {} },
  });
  const walk = element => !element || typeof element !== "object" ? [] : Array.isArray(element)
    ? element.flatMap(walk) : [element, ...walk(element.props?.children)];
  function render(wrapper = false) {
    let tree;
    do {
      dirty = false; cursor = 0;
      tree = wrapper ? api.AssignedFinalReview({ id: 7, version: 8, status: "submitted", submissionId: 2,
        photos: ["synthetic.jpg"], fields: { name: "Synthetic" }, postRevision: 0, baseRevision: 0, teacherId: null })
        : api.FinalReviewPanel({ submissionId: 2, version: 8, ...(previewReady === undefined ? {} : { previewReady }) });
    } while (dirty);
    const elements = walk(tree);
    return {
      tree, elements,
      confirmation: elements.find(e => e.props?.name === "confirmPublish"),
      approve: elements.find(e => e.props?.value === "approve"),
      returned: elements.find(e => e.props?.value === "return"),
      prevented(intent) {
        let prevented = false;
        tree.props.onSubmit({ nativeEvent: { submitter: { getAttribute: () => intent } }, preventDefault() { prevented = true; } });
        return prevented;
      },
    };
  }
  return { api, render, setReady: value => { previewReady = value; }, setPending: value => { pending = value; },
    setState: value => { actionState = value; } };
}

test("final review blocks publication until every preview is ready while allowing return", () => {
  const f = panelFixture();
  const view = f.render();
  assert.equal(view.confirmation, undefined);
  assert.equal(view.approve.props.disabled, true);
  assert.equal(view.returned.props.disabled, undefined);
  assert.equal(view.prevented("approve"), true);
  assert.equal(view.prevented("return"), false);
  assert.match(JSON.stringify(view.tree), /加载失败/);
  f.setReady(true);
  assert.equal(f.render().confirmation, undefined);
  assert.equal(f.render().approve.props.disabled, false);
  assert.equal(f.render().prevented("approve"), false);
});

test("photo readiness still blocks approval without an extra confirmation checkbox", () => {
  const f = panelFixture();
  f.setReady(true);
  assert.equal(f.render().approve.props.disabled, false);
  f.setReady(false);
  assert.equal(f.render().confirmation, undefined);
  assert.equal(f.render().approve.props.disabled, true);
  assert.equal(f.render().prevented("return"), false);
  f.setReady(true);
  assert.equal(f.render().confirmation, undefined);
  assert.equal(f.render().approve.props.disabled, false);
});

test("final review becomes inert while submitting and after completion", () => {
  const f = panelFixture();
  f.setReady(true);
  f.setPending(true);
  assert.equal(f.render().elements.find(e => e.type === "fieldset").props.disabled, true);
  assert.equal(f.render().prevented("return"), true);
  f.setPending(false); f.setState({ message: "Published" });
  assert.equal(f.render().elements.find(e => e.type === "fieldset").props.disabled, true);
  assert.equal(f.render().prevented("approve"), true);
});

test("the final review wrapper shares photo readiness between two sibling forms", () => {
  const f = panelFixture();
  let view = f.render(true);
  const draft = view.elements.find(e => e.type === "DraftForm");
  let panel = view.elements.find(e => e.type === f.api.FinalReviewPanel);
  assert.equal(view.tree.type, jsx.Fragment);
  assert.equal(view.tree.props.children.length, 2);
  assert.equal(draft.props.mode, "admin");
  assert.equal(draft.props.status, "submitted");
  assert.equal(panel.props.previewReady, false);
  assert.equal(panel.props.submissionId, 2);
  assert.equal(panel.props.version, 8);
  draft.props.onPreviewReadyChange(true);
  view = f.render(true);
  panel = view.elements.find(e => e.type === f.api.FinalReviewPanel);
  assert.equal(panel.props.previewReady, true);
  view.elements.find(e => e.type === "DraftForm").props.onPreviewReadyChange(false);
  assert.equal(f.render(true).elements.find(e => e.type === f.api.FinalReviewPanel).props.previewReady, false);
});

function legacySubmissionFixture({ imported = false, kind = "create" } = {}) {
  const calls = [];
  const submission = {
    id: 2, submissionKey: imported ? "partner-import:7" : "1:synthetic-request", kind, status: "pending",
    teamAccountId: 1, teacherId: kind === "update" ? 42 : null,
    name: "Synthetic", type: "钢琴", city: "", district: "", price: "", services: "Synthetic",
    courseNotes: null, age: null, photos: '["/uploads/synthetic.jpg"]', emoji: "",
    phone: "Synthetic", wechat: "", qq: null, otherContact: null, address: null,
    teacher: { photos: "[]" },
  };
  const tx = {
    teacherSubmission: {
      findUnique: async args => {
        calls.push(["read", args]);
        assert.ok(args.select);
        assert.equal(Object.hasOwn(args.select, "partnerImportDraftId"), false);
        assert.equal(args.select.submissionKey, true);
        return submission;
      },
      update: async args => {
        calls.push(["updateSubmission", args]);
        assert.deepEqual(JSON.parse(JSON.stringify(args.select)), { id: true });
        return { id: 2 };
      },
      updateMany: async args => { calls.push(["updateSubmission", args]); return { count: 1 }; },
    },
    teacher: {
      create: async () => { calls.push(["createTeacher"]); return { id: 42 }; },
      update: async () => { calls.push(["updateTeacher"]); return { id: 42 }; },
    },
    teacherOwnership: {
      create: async () => { calls.push(["createOwner"]); },
      findUnique: async () => ({ teamAccountId: 1, teacher: { photos: "[]" } }),
    },
  };
  const api = load("src/app/adminzhangzhang/submissions/actions.ts", {
    "next/cache": { revalidatePath: () => {} },
    "@/lib/auth": { requireAdmin: async () => {} },
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => false },
    "@/lib/prisma": { prisma: { ...tx, $transaction: async callback => callback(tx) } },
    "@/lib/uploaded-photos": { deleteUploadedPhotos: async () => { calls.push(["deletePhotos"]); } },
  });
  return { api, calls };
}

test("legacy-schema ordinary submission review reads and returns only old scalar fields", async () => {
  for (const kind of ["create", "update"]) {
    const f = legacySubmissionFixture({ kind });
    await f.api.approveTeacherSubmission(2);
    assert.ok(f.calls.some(call => call[0] === "updateSubmission"));
  }
  const rejection = legacySubmissionFixture();
  await rejection.api.rejectTeacherSubmission(2, new FormData());
  assert.ok(rejection.calls.some(call => call[0] === "updateSubmission"));
  assert.ok(rejection.calls.some(call => call[0] === "deletePhotos"));
});

test("old clients retain the import-review guard through the existing submission key", async () => {
  for (const approve of [true, false]) {
    const f = legacySubmissionFixture({ imported: true });
    await assert.rejects(approve ? f.api.approveTeacherSubmission(2) : f.api.rejectTeacherSubmission(2, new FormData()), /导入稿终审页/);
    assert.deepEqual(f.calls.map(call => call[0]), ["read"]);
  }
});
