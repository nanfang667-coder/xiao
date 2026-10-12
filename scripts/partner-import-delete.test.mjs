import * as coverApi from "../src/lib/partner-import-photo-cover.ts";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Only source files are read. All records, private files, network and publication
// operations are synthetic in-memory doubles; no environment files are loaded.
const sentinel = "SYNTHETIC_PRIVATE_RECORD";
const key = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0") + ".jpg";
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, FormData, ...globals, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unmocked dependency: " + name);
    return mocks[name];
  } });
  return exports;
}
function form(values = ["1:1", "2:1"], confirmed = true) {
  const result = new FormData();
  for (const value of values) result.append("draft", value);
  if (confirmed) result.set("confirmDelete", "yes");
  return result;
}
function matches(row, where) {
  return Object.entries(where).every(([field, value]) => {
    if (field === "OR") return value.some(clause => matches(row, clause));
    return value && typeof value === "object" && "in" in value
      ? value.in.includes(row[field]) : row[field] === value;
  });
}
function setup(options = {}) {
  let state = {
    drafts: [
      { id: 1, version: 1, status: "pending", photos: JSON.stringify([key(1)]), postId: 1, baseRevision: 0, fields: JSON.stringify({ name: sentinel }) },
      { id: 2, version: 1, status: "rejected", photos: JSON.stringify([key(2)]), postId: 2, fields: sentinel },
      { id: 3, version: 1, status: "published", photos: JSON.stringify([key(3)]), postId: 3, fields: sentinel },
    ],
    items: [{ id: 1, draftId: 1, status: "imported" }, { id: 2, draftId: 2, status: "skipped" }, { id: 3, draftId: 3, status: "imported" }],
    posts: [{ id: 1, revision: 0, teacherId: null }, { id: 3, revision: 1, teacherId: 42 }],
    teachers: [{ id: 42, fields: sentinel }],
  };
  if (options.mutate) options.mutate(state);
  const calls = [];
  const unexpected = () => { throw new Error("Unexpected external operation"); };
  const photos = load("src/lib/partner-import-photos.ts", {
    "node:crypto": {},
    "node:fs/promises": {
      mkdir: unexpected, readFile: unexpected, copyFile: unexpected,
      unlink: async filename => {
        calls.push(["unlink", filename]);
        assert.equal(calls.some(call => call[0] === "commit"), true, "Photos may only be removed after commit");
        if (options.unlinkError) throw Object.assign(new Error(sentinel), { code: options.unlinkError });
      },
    },
    "node:path": path,
    "node:fs": { constants: {} },
    "./image-upload": { saveUploadedPhotos: unexpected },
    "./partner-import-fetch": { fetchPartnerResource: unexpected },
    "./partner-import-photo-cover": coverApi,
    "./partner-import-photo-cover-render": { renderPartnerPhotoCover: unexpected },
  }, { process: { cwd: () => path.resolve("synthetic-workspace") } });
  const prisma = {
    partnerImportDraft: {
      findMany: async args => {
        calls.push(["findMany", plain(args)]);
        return state.drafts.filter(row => matches(row, args.where)).map(row => {
          return Object.fromEntries(Object.keys(args.select).map(field => [field, row[field]]));
        });
      },
      findUnique: async ({ where }) => {
        const row = state.drafts.find(row => matches(row, where));
        return row ? { ...structuredClone(row), post: { id: 1, revision: 0, sourceId: 1 } } : null;
      },
      updateMany: async ({ where }) => {
        const rows = state.drafts.filter(row => matches(row, where));
        assert.equal(rows.length, 0, "Publication must fail before touching a deleted draft");
        return { count: 0 };
      },
      deleteMany: async ({ where }) => {
        calls.push(["deleteMany", plain(where)]);
        if (options.concurrentChange) state.drafts[0][options.concurrentChange] = options.concurrentChange === "version" ? 2 : "published";
        const deleted = state.drafts.filter(row => matches(row, where));
        state.drafts = state.drafts.filter(row => !matches(row, where));
        return { count: deleted.length };
      },
    },
    partnerImportItem: { updateMany: async ({ where, data }) => {
      calls.push(["itemUpdate", plain({ where, data })]);
      if (options.failItems) throw new Error(sentinel);
      const rows = state.items.filter(row => matches(row, where));
      rows.forEach(row => Object.assign(row, data));
      return { count: rows.length };
    } },
    $transaction: async callback => {
      calls.push(["begin"]);
      const before = structuredClone(state);
      try {
        const result = await callback(prisma);
        if (options.failCommit) throw new Error(sentinel);
        calls.push(["commit"]);
        return result;
      } catch (error) {
        state = before;
        calls.push(["rollback"]);
        throw error;
      }
    },
  };
  class PartnerImportError extends Error {}
  const api = load("src/lib/partner-import-delete.ts", {
    "server-only": {}, "./prisma": { prisma }, "./partner-import": { PartnerImportError },
    "./partner-import-photos": photos,
  });
  return { api, prisma, photos, calls, state: () => structuredClone(state) };
}

test("confirmed batch deletes selected pending/rejected drafts atomically and only then their private photos", async () => {
  const f = setup();
  const before = f.state();
  const result = await f.api.deleteImportDrafts(form());
  assert.deepEqual(plain(result.deletedDraftIds), [1, 2]);
  assert.match(result.message, /已删除 2 篇/);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  const after = f.state();
  assert.deepEqual(after.drafts, before.drafts.filter(row => row.id === 3));
  assert.deepEqual(after.posts, before.posts);
  assert.deepEqual(after.teachers, before.teachers);
  assert.deepEqual(after.items, before.items.map(row => ({ ...row, draftId: row.id < 3 ? null : row.draftId })));
  assert.deepEqual(f.calls.find(call => call[0] === "findMany")[1], {
    where: { id: { in: [1, 2] } }, select: { id: true, version: true, status: true, photos: true },
  });
  assert.deepEqual(f.calls.find(call => call[0] === "deleteMany")[1], {
    OR: [{ id: 1, version: 1 }, { id: 2, version: 1 }], status: { in: ["pending", "rejected"] },
  });
  assert.deepEqual(f.calls.filter(call => call[0] === "unlink").map(call => path.basename(call[1])), [key(1), key(2)]);
});

test("missing confirmation rejects before database or private file access", async () => {
  const f = setup();
  await assert.rejects(f.api.deleteImportDrafts(form(undefined, false)), /请确认/);
  assert.deepEqual(f.calls, []);
});

test("empty, oversized, duplicate and malformed selections reject before database access", async () => {
  for (const values of [
    [], Array.from({ length: 21 }, (_, n) => (n + 1) + ":1"), ["1:1", "1:1"], ["1:1", "1:2"],
    ["01:1"], ["1:01"], ["0:1"], ["1:0"], ["-1:1"], ["1:-1"], ["1.5:1"], ["1:1.5"],
    ["1e2:1"], ["1:1e2"], [" 1:1"], ["1:1 "], ["1"], ["1:1:1"], ["1:NaN"], ["NaN:1"],
    ["9007199254740992:1"], ["1:9007199254740992"], ["1".repeat(10000) + ":1"],
    [new File(["synthetic"], "draft.txt")],
  ]) {
    const f = setup();
    await assert.rejects(f.api.deleteImportDrafts(form(values)));
    assert.deepEqual(f.calls, [], "Invalid input must have no effects");
  }
});

test("up to 20 correctly versioned drafts can be deleted in one batch", async () => {
  const f = setup({ mutate(state) {
    state.drafts = Array.from({ length: 20 }, (_, n) => ({ id: n + 1, version: 1, status: "pending", photos: "[]" }));
  } });
  const result = await f.api.deleteImportDrafts(form(Array.from({ length: 20 }, (_, n) => (n + 1) + ":1")));
  assert.equal(result.deletedDraftIds.length, 20);
  assert.equal(f.state().drafts.length, 0);
});

test("any published, missing or stale selection leaves the whole batch and photos intact", async () => {
  for (const values of [["1:1", "3:1"], ["1:1", "9:1"], ["1:2", "2:1"]]) {
    const f = setup();
    const before = f.state();
    await assert.rejects(f.api.deleteImportDrafts(form(values)), /已变更或不再可删除/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.some(call => ["deleteMany", "unlink"].includes(call[0])), false);
  }
});

test("unknown draft status and invalid private photo records abort the whole batch", async () => {
  for (const change of [
    row => { row.status = "unexpected"; },
    row => { row.photos = "malformed-json"; },
    row => { row.photos = JSON.stringify(["../../outside.jpg"]); },
    row => { row.photos = JSON.stringify(Array.from({ length: 9 }, (_, n) => key(n))); },
  ]) {
    const f = setup({ mutate: state => change(state.drafts[1]) });
    const before = f.state();
    await assert.rejects(f.api.deleteImportDrafts(form()));
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.some(call => ["deleteMany", "unlink"].includes(call[0])), false);
  }
});

test("concurrent review or version change aborts and rolls back the entire deletion", async () => {
  for (const concurrentChange of ["version", "status"]) {
    const f = setup({ concurrentChange });
    const before = f.state();
    await assert.rejects(f.api.deleteImportDrafts(form()), /已变更或不再可删除/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.some(call => ["itemUpdate", "unlink"].includes(call[0])), false);
  }
});

test("transaction failures roll back draft and item changes without removing files", async () => {
  for (const options of [{ failItems: true }, { failCommit: true }]) {
    const f = setup(options);
    const before = f.state();
    await assert.rejects(f.api.deleteImportDrafts(form()));
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.some(call => call[0] === "unlink"), false);
  }
});

test("photo cleanup failures report completed draft deletion using a fixed private message", async () => {
  const f = setup({ unlinkError: "EACCES" });
  const result = await f.api.deleteImportDrafts(form());
  assert.deepEqual(plain(result.deletedDraftIds), [1, 2]);
  assert.match(result.message, /已删除 2 篇.*部分私有照片清理未完成/);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.deepEqual(f.state().drafts.map(row => row.id), [3]);
});

test("already absent photos count as successfully cleaned", async () => {
  const f = setup({ unlinkError: "ENOENT" });
  const result = await f.api.deleteImportDrafts(form());
  assert.match(result.message, /已删除 2 篇草稿及其私有照片/);
});

test("duplicate photo keys in selected records are cleaned only once", async () => {
  const f = setup({ mutate: state => { state.drafts[1].photos = JSON.stringify([key(1), key(1)]); } });
  await f.api.deleteImportDrafts(form());
  assert.equal(f.calls.filter(call => call[0] === "unlink").length, 1);
});

test("publication started before deletion cannot commit afterwards and cleans temporary public photos", async () => {
  const f = setup();
  const publicRemoved = [];
  let releasePublication;
  let publicationStarted;
  const started = new Promise(resolve => { publicationStarted = resolve; });
  const paused = new Promise(resolve => { releasePublication = resolve; });
  const core = load("src/lib/partner-import.ts", {
    "server-only": {}, "node:crypto": {},
    "./prisma": { prisma: f.prisma }, "./partner-import-fetch": {}, "./partner-import-parser": {},
    "./partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => false },
    "./partner-import-declarations": load("src/lib/partner-import-declarations.ts", {}),
    "./partner-import-photo-cover": coverApi,
    "./partner-import-photos": { ...f.photos, publishPartnerPhotos: async () => {
      publicationStarted();
      await paused;
      return ["/uploads/synthetic-temporary.jpg"];
    } },
    "./uploaded-photos": { deleteUploadedPhotos: async photos => { publicRemoved.push(JSON.parse(photos)); } },
    "./teacher-post-input": { extractTeacherPostFields: () => ({ name: "虚构测试", services: "虚构正文", phone: "synthetic" }) },
    "./photo": {}, "./partner-import-errors": {},
  });
  const reviewForm = new FormData();
  reviewForm.set("intent", "publish");
  reviewForm.set("confirmPublish", "yes");
  reviewForm.set("postRevision", "0");
  reviewForm.set("type", "钢琴");
  reviewForm.append("keepPhotos", key(1));
  const publishing = core.reviewImportDraft(1, 1, reviewForm);
  await started;
  const result = await f.api.deleteImportDrafts(form(["1:1"]));
  assert.deepEqual(plain(result.deletedDraftIds), [1]);
  releasePublication();
  await assert.rejects(publishing, /待审稿已变更/);
  assert.deepEqual(publicRemoved, [["/uploads/synthetic-temporary.jpg"]]);
  assert.deepEqual(f.state().teachers, [{ id: 42, fields: sentinel }]);
  assert.deepEqual(f.state().posts, [{ id: 1, revision: 0, teacherId: null }, { id: 3, revision: 1, teacherId: 42 }]);
});
