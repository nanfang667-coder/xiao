import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; } });
  return exports;
}

// All records and uploaded-photo operations are synthetic in-memory fixtures.
function fixture({ authorized = true, hasImportReference = false, submissionKey = "1:synthetic-request",
  draftId = null, kind = "create", status = "pending", ownershipAccount = 1, metadataError = false } = {}) {
  const calls = [];
  const submission = {
    id: 2, submissionKey, partnerImportDraftId: draftId, kind, status,
    teamAccountId: 1, teacherId: kind === "update" ? 42 : null,
    name: "Synthetic", type: "钢琴", city: "", district: "", price: "", services: "Synthetic",
    courseNotes: null, age: null, photos: '["/uploads/synthetic-new.jpg","/uploads/synthetic-shared.jpg"]', emoji: "",
    phone: "Synthetic", wechat: "", qq: null, otherContact: null, address: null,
    teacher: { photos: '["/uploads/synthetic-old.jpg","/uploads/synthetic-shared.jpg"]' },
  };
  const tx = {
    teacherSubmission: {
      findUnique: async args => {
        calls.push(["read", args]);
        assert.equal(Object.hasOwn(args.select, "partnerImportDraftId"), hasImportReference);
        assert.equal(args.select.submissionKey, true);
        return submission;
      },
      update: async args => { calls.push(["updateSubmission", args]); return { id: 2 }; },
      updateMany: async args => { calls.push(["updateSubmission", args]); return { count: 1 }; },
    },
    teacher: {
      create: async args => { calls.push(["createTeacher", args]); return { id: 42 }; },
      update: async args => { calls.push(["updateTeacher", args]); return { id: 42 }; },
    },
    teacherOwnership: {
      create: async args => { calls.push(["createOwner", args]); },
      findUnique: async () => ({ teamAccountId: ownershipAccount, teacher: submission.teacher }),
    },
  };
  const api = load("src/app/adminzhangzhang/submissions/actions.ts", {
    "next/cache": { revalidatePath: path => { calls.push(["refresh", path]); } },
    "@/lib/auth": { requireAdmin: async () => { if (!authorized) throw new Error("DENIED"); } },
    "@/lib/ordinary-submission-boundary": { getOrdinarySubmissionBoundary: async () => {
      if (metadataError) throw new Error("SCHEMA_UNAVAILABLE");
      return { hasImportReference };
    } },
    "@/lib/prisma": { prisma: { ...tx, $transaction: async callback => callback(tx) } },
    "@/lib/uploaded-photos": { deleteUploadedPhotos: async photos => { calls.push(["deletePhotos", JSON.parse(photos)]); } },
  });
  return { api, calls };
}

test("ordinary approval supports create and update against both historical and current schemas", async () => {
  for (const hasImportReference of [false, true]) {
    for (const kind of ["create", "update"]) {
      const f = fixture({ kind, hasImportReference });
      await f.api.approveTeacherSubmission(2);
      assert.ok(f.calls.some(call => call[0] === "updateSubmission"));
      assert.ok(f.calls.some(call => call[0] === (kind === "create" ? "createTeacher" : "updateTeacher")));
      if (kind === "update") assert.deepEqual(f.calls.find(call => call[0] === "deletePhotos")[1], ["/uploads/synthetic-old.jpg"]);
      else assert.equal(f.calls.some(call => call[0] === "deletePhotos"), false);
    }
  }
});

test("ordinary rejection deletes only draft-specific photos and keeps the live teacher photos", async () => {
  const f = fixture({ kind: "update" });
  const form = new FormData(); form.set("reviewNote", "  Synthetic note  ");
  await f.api.rejectTeacherSubmission(2, form);
  const mutation = f.calls.find(call => call[0] === "updateSubmission")[1];
  assert.equal(mutation.data.reviewNote, "Synthetic note");
  assert.equal(mutation.where.status, "pending");
  assert.deepEqual(f.calls.find(call => call[0] === "deletePhotos")[1], ["/uploads/synthetic-new.jpg"]);
});

test("historical imported keys and id-only references cannot publish, reject, delete photos or refresh", async () => {
  for (const marker of [
    { submissionKey: "partner-import:7", hasImportReference: false },
    { submissionKey: null, draftId: 7, hasImportReference: true },
    { submissionKey: "partner-import:7", draftId: 7, hasImportReference: true },
  ]) {
    for (const approve of [true, false]) {
      const f = fixture(marker);
      await assert.rejects(approve ? f.api.approveTeacherSubmission(2) : f.api.rejectTeacherSubmission(2, new FormData()), /不是普通团队投稿/);
      assert.deepEqual(f.calls.map(call => call[0]), ["read"]);
    }
  }
});

test("review authenticates before schema checks, records or private form input", async () => {
  const unreadable = { get() { throw new Error("PRIVATE_FORM_MUST_NOT_BE_READ"); } };
  const f = fixture({ authorized: false, metadataError: true });
  await assert.rejects(f.api.approveTeacherSubmission(2), /DENIED/);
  await assert.rejects(f.api.rejectTeacherSubmission(2, unreadable), /DENIED/);
  assert.equal(f.calls.length, 0);
});

test("schema detection errors fail closed before any submission is read or changed", async () => {
  const f = fixture({ metadataError: true });
  await assert.rejects(f.api.approveTeacherSubmission(2), /SCHEMA_UNAVAILABLE/);
  await assert.rejects(f.api.rejectTeacherSubmission(2, new FormData()), /SCHEMA_UNAVAILABLE/);
  assert.equal(f.calls.length, 0);
});

test("a different team's ownership cannot be overwritten during an ordinary update", async () => {
  const f = fixture({ kind: "update", ownershipAccount: 9 });
  await assert.rejects(f.api.approveTeacherSubmission(2), /ownership mismatch/);
  assert.deepEqual(f.calls.map(call => call[0]), ["read"]);
});

test("reviewed records cannot create another teacher or remove photos", async () => {
  for (const status of ["approved", "rejected"]) {
    const f = fixture({ status });
    await f.api.approveTeacherSubmission(2);
    await f.api.rejectTeacherSubmission(2, new FormData());
    assert.equal(f.calls.some(call => /create|update|delete/.test(call[0])), false);
  }
});

test("the historical boundary reads only fixed column metadata and handles schema upgrades", async () => {
  let hasColumn = false;
  const filters = load("src/lib/cooperation-filters.ts", {});
  const api = load("src/lib/ordinary-submission-boundary.ts", {
    "server-only": {}, "@/lib/cooperation-filters": filters,
    "@/lib/prisma": { prisma: { $queryRaw: async (strings, ...values) => {
      assert.equal(strings.join(""), 'PRAGMA table_info("TeacherSubmission")');
      assert.equal(values.length, 0);
      return [{ name: "submissionKey" }, ...(hasColumn ? [{ name: "partnerImportDraftId" }] : [])];
    } } },
  });
  const old = await api.getOrdinarySubmissionBoundary();
  assert.equal(old.hasImportReference, false);
  assert.equal(Object.hasOwn(old.where, "partnerImportDraftId"), false);
  hasColumn = true;
  const current = await api.getOrdinarySubmissionBoundary();
  assert.equal(current.hasImportReference, true);
  assert.equal(current.where.partnerImportDraftId, null);
  assert.equal(current.where.OR[1].NOT.submissionKey.startsWith, "partner-import:");
});
