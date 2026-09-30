import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as coverApi from "../src/lib/partner-import-photo-cover.ts";

// Only synthetic state is used. File reads are limited to source/migration code.
const key = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0") + ".jpg";
const fields = {
  name: "虚构分配稿", type: "钢琴", city: "虚构市", district: "", price: "",
  services: "虚构服务正文", courseNotes: "虚构介绍", age: "28", phone: "synthetic-contact",
  wechat: "", qq: null, otherContact: null, address: null,
};
const assignmentReadiness = {
  isPartnerImportAssignmentReady: async () => true,
  requirePartnerImportAssignmentReady: async () => {},
  PartnerImportAssignmentUnavailableError: class extends Error {},
  PARTNER_ASSIGNMENT_UNAVAILABLE: "分配流程尚未启用，请完成数据库升级并重启服务后再试。",
};

const clone = value => value == null ? value : structuredClone(value);
function load(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, FormData, Date, Buffer, URL, TextDecoder, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
    return mocks[name];
  } });
  return exports;
}
const fieldApi = load("src/lib/teacher-post-input.ts", {});
const declarations = load("src/lib/partner-import-declarations.ts", {});
const quota = load("src/lib/team-post-quota.ts", {});
const errors = load("src/lib/partner-import-errors.ts", {});
function setup() {
  let state = {
    sites: [{ id: "synthetic-site", isActive: true }],
    accounts: [1, 2].map(id => ({ id, siteId: "synthetic-site", isActive: true, monthlyPostLimit: 30,
      monthlyPostLimitOverride: 22, monthlyPostBonus: 0, monthlyPostBonusMonth: null })),
    posts: [{ id: 1, sourceId: 1, sourceUrl: "https://partner.example/post/1", revision: 0, teacherId: null }],
    drafts: [{ id: 1, postId: 1, status: "pending", teamAccountId: null, version: 1, baseRevision: 0,
      fields: JSON.stringify({ ...fields, _photoCover: coverApi.DEFAULT_PARTNER_PHOTO_COVER }), photos: JSON.stringify([key(1)]), contentHash: "synthetic-hash" }],
    submissions: [], teachers: [], ownerships: [],
  };
  const observed = { publicWritten: [], publicRemoved: [], privateRemoved: [], covers: [], calls: [] };
  const control = { failTeacher: false, beforePublish: null, beforeApprovalClaim: null };
  let queue = Promise.resolve();
  function matches(row, where = {}) {
    return Object.entries(where).every(([field, value]) => {
      if (field === "AND") return value.every(part => matches(row, part));
      if (field === "OR") return value.some(part => matches(row, part));
      if (field === "post") return matches(state.posts.find(post => post.id === row.postId), value);
      if (field === "site") return matches(state.sites.find(site => site.id === row.siteId), value);
      if (field === "drafts") return !state.drafts.some(draft => draft.postId === row.id && matches(draft, value.none));
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if ("in" in value) return value.in.includes(row[field]);
        if ("not" in value) return row[field] !== value.not;
        if ("gte" in value || "lt" in value) return (!("gte" in value) || new Date(row[field]) >= value.gte) && (!("lt" in value) || new Date(row[field]) < value.lt);
        return Object.entries(value).every(([nested, expected]) => row[nested] === expected);
      }
      return (row[field] ?? null) === value;
    });
  }
  function apply(row, data) {
    for (const [field, value] of Object.entries(data)) row[field] = value && typeof value === "object" && "increment" in value ? row[field] + value.increment : clone(value);
  }
  function includeRelations(name, row, include) {
    const value = clone(row);
    if (include?.post) value.post = clone(state.posts.find(post => post.id === row.postId));
    if (name === "posts" && include?.drafts) {
      const options = include.drafts;
      value.drafts = state.drafts.filter(draft => draft.postId === row.id && matches(draft, options.where))
        .sort((a, b) => b.id - a.id).slice(0, options.take)
        .map(draft => Object.fromEntries(Object.keys(options.select).filter(key => options.select[key]).map(key => [key, clone(draft[key])])));
      observed.calls.push(["approval-metadata-select", clone(include)]);
    }
    if (include?.partnerImportDraft) {
      const draft = state.drafts.find(draft => draft.id === row.partnerImportDraftId);
      value.partnerImportDraft = draft ? includeRelations("drafts", draft, include.partnerImportDraft.include) : null;
    }
    return value;
  }
  function table(name) {
    return {
      findUnique: async ({ where, include, select }) => {
        observed.calls.push([name, "findUnique", clone(where)]);
        const row = state[name].find(row => matches(row, where));
        return row ? includeRelations(name, row, include ?? select) : null;
      },
      findFirst: async ({ where }) => clone(state[name].find(row => matches(row, where)) ?? null),
      findMany: async ({ where }) => clone(state[name].filter(row => matches(row, where))),
      count: async ({ where }) => state[name].filter(row => matches(row, where)).length,
      updateMany: async ({ where, data }) => {
        if (name === "drafts" && data.status === "ready") await control.beforeApprovalClaim?.(where);
        const rows = state[name].filter(row => matches(row, where));
        for (const row of rows) apply(row, data);
        return { count: rows.length };
      },
      update: async ({ where, data }) => {
        const row = state[name].find(row => matches(row, where));
        assert.ok(row, "Missing synthetic row");
        apply(row, data);
        return clone(row);
      },
      create: async ({ data }) => {
        if (name === "submissions") assert.ok(!state.submissions.some(row => row.partnerImportDraftId === data.partnerImportDraftId));
        if (name === "ownerships") assert.ok(!state.ownerships.some(row => row.teacherId === data.teacherId));
        const row = { id: Math.max(0, ...state[name].map(row => row.id ?? 0)) + 1, createdAt: new Date(), ...clone(data) };
        state[name].push(row);
        return clone(row);
      },
      upsert: async ({ where, create, update }) => {
        if (name === "teachers" && control.failTeacher) throw new Error("SYNTHETIC_PRIVATE_DATABASE_FAILURE");
        const row = state[name].find(row => matches(row, where));
        if (row) { apply(row, update); return clone(row); }
        return table(name).create({ data: create });
      },
    };
  }
  const prisma = Object.fromEntries([
    ["teamAccount", "accounts"], ["partnerImportDraft", "drafts"], ["partnerImportedPost", "posts"],
    ["teacherSubmission", "submissions"], ["teacher", "teachers"], ["teacherOwnership", "ownerships"],
  ].map(([delegate, name]) => [delegate, table(name)]));
  prisma.$transaction = async callback => {
    let unlock;
    const previous = queue;
    queue = new Promise(resolve => { unlock = resolve; });
    await previous;
    const before = clone(state);
    try { return await callback(prisma); }
    catch (error) { state = before; throw error; }
    finally { unlock(); }
  };
  const photos = {
    parsePartnerPhotoKeys(value) {
      const keys = JSON.parse(value);
      assert.ok(Array.isArray(keys) && keys.every(key => typeof key === "string"));
      return keys;
    },
    async publishPartnerPhotos(keys, cover) {
      await control.beforePublish?.();
      observed.covers.push(clone(cover));
      const urls = keys.map((_, index) => "/uploads/synthetic-" + (observed.publicWritten.length + index + 1) + ".jpg");
      observed.publicWritten.push(...urls);
      return urls;
    },
    async removePartnerPrivatePhotos(keys) { observed.privateRemoved.push(...keys); return 0; },
  };
  const photo = { defaultGradients: () => ["synthetic-gradient"], emojiFor: () => "🎹" };
  const unexpected = () => { throw new Error("Unexpected network or parser operation"); };
  const core = load("src/lib/partner-import.ts", {
    "server-only": {}, "node:crypto": crypto, "./prisma": { prisma },
    "./partner-import-fetch": { fetchPartnerResource: unexpected },
    "./partner-import-parser": { normalizePartnerImportRules: unexpected, parsePartnerDetail: unexpected, parsePartnerListing: unexpected },
    "./partner-import-assignment-readiness": assignmentReadiness,
    "./partner-import-errors": errors, "./partner-import-declarations": declarations,
    "./partner-import-photo-cover": coverApi, "./partner-import-photos": photos,
    "./uploaded-photos": { deleteUploadedPhotos: async value => observed.publicRemoved.push(...JSON.parse(value)) },
    "./teacher-post-input": fieldApi, "./photo": photo,
  });
  const api = load("src/lib/partner-import-assignment.ts", {
    "server-only": {}, "./prisma": { prisma }, "./partner-import": core,
    "./partner-import-assignment-readiness": assignmentReadiness,
    "./teacher-post-input": fieldApi, "./partner-import-declarations": declarations,
    "./partner-import-photos": photos, "./partner-import-photo-cover": coverApi, "./team-post-quota": quota, "./photo": photo,
  });
  function batch(ids = [1], accountId) {
    const form = new FormData();
    for (const id of ids) {
      const draft = state.drafts.find(row => row.id === id);
      form.append("draft", id + ":" + draft.version);
    }
    if (accountId !== undefined) form.set("teamAccountId", String(accountId));
    return form;
  }
  function memberForm(id = 1, intent = "save", changes = {}) {
    const draft = state.drafts.find(row => row.id === id);
    const form = new FormData();
    for (const [key, value] of Object.entries(JSON.parse(draft.fields))) if (typeof value === "string") form.set(key, value);
    for (const key of JSON.parse(draft.photos)) form.append("keepPhotos", key);
    form.set("intent", intent);
    for (const [key, value] of Object.entries(changes)) form.set(key, value);
    return form;
  }
  async function assign(id = 1, accountId = 1) {
    await api.approveImportDrafts(batch([id]));
    await api.assignImportDrafts(batch([id], accountId));
  }
  async function submit(id = 1) {
    const draft = state.drafts.find(row => row.id === id);
    return api.saveAssignedImportDraft(draft.teamAccountId, id, draft.version, memberForm(id, "submit"));
  }
  function addDraft({ id = 2, postId = 2, status = "pending", teamAccountId = null } = {}) {
    if (!state.posts.some(post => post.id === postId)) state.posts.push({ ...clone(state.posts[0]), id: postId, revision: 0, teacherId: null });
    state.drafts.push({ ...clone(state.drafts[0]), id, postId, status, teamAccountId, version: 1, contentHash: "synthetic-hash-" + id, photos: JSON.stringify([key(id)]) });
  }
  return { api, core, batch, memberForm, assign, submit, addDraft, state: () => state, observed, control };
}

test("initial approval and assignment stay private; final approval alone publishes and creates ownership", async () => {
  const f = setup();
  await f.assign();
  assert.equal(f.state().drafts[0].status, "assigned");
  assert.equal(f.state().submissions.length, 0);
  assert.equal(f.state().teachers.length, 0);
  assert.deepEqual(f.observed.publicWritten, []);
  const submission = await f.submit();
  assert.equal(submission.submissionId, 1);
  assert.equal(f.state().drafts[0].status, "submitted");
  assert.equal(f.state().submissions[0].kind, "create");
  assert.equal(f.state().submissions[0].photos, "[]");
  assert.equal(f.state().submissions[0].status, "pending");
  assert.equal(f.state().teachers.length, 0);
  const approved = await f.api.reviewAssignedImportDraft(1, "approve", undefined, f.state().drafts[0].version);
  assert.equal(approved.teacherId, 1);
  assert.equal(f.state().drafts[0].status, "published");
  assert.equal(f.state().submissions[0].status, "approved");
  assert.equal(f.state().submissions[0].teacherId, 1);
  assert.equal(f.state().ownerships[0].teamAccountId, 1);
  assert.equal(f.state().posts[0].teacherId, 1);
  assert.equal(f.state().posts[0].revision, 1);
  assert.equal(f.state().teachers[0].source, "partner:1");
  assert.equal(f.state().teachers[0].sourceId, 1);
  assert.equal(Object.hasOwn(f.state().teachers[0], "_photoCover"), false);
  assert.deepEqual(f.observed.covers, [coverApi.DEFAULT_PARTNER_PHOTO_COVER]);
});

test("initial selection is bounded, versioned and all-or-nothing", async () => {
  const f = setup();
  f.addDraft();
  const stale = f.batch([1, 2]);
  f.state().drafts[1].version++;
  await assert.rejects(f.api.approveImportDrafts(stale), /状态或版本/);
  assert.equal(f.state().drafts[0].status, "pending");
  for (const values of [[], ["1:1", "1:1"], ["../1:1"], Array(21).fill("1:1")]) {
    const form = new FormData();
    values.forEach(value => form.append("draft", value));
    await assert.rejects(f.api.approveImportDrafts(form), error => error instanceof f.core.PartnerImportError);
  }
});

test("only one unpublished version of a source post can enter assignment", async () => {
  const f = setup();
  f.addDraft({ postId: 1 });
  await assert.rejects(f.api.approveImportDrafts(f.batch([1, 2])));
  await f.api.approveImportDrafts(f.batch([1]));
  await assert.rejects(f.api.approveImportDrafts(f.batch([2])), /其他版本/);
  assert.equal(f.state().drafts[1].status, "pending");
  const published = setup();
  published.state().posts[0].teacherId = 3;
  published.state().posts[0].revision = 1;
  await assert.rejects(published.api.approveImportDrafts(published.batch()), /已发布/);
});

test("disabled member or site blocks assignment, editing and approval", async () => {
  for (const siteDisabled of [false, true]) {
    const f = setup();
    await f.api.approveImportDrafts(f.batch());
    (siteDisabled ? f.state().sites[0] : f.state().accounts[0]).isActive = false;
    await assert.rejects(f.api.assignImportDrafts(f.batch([1], 1)), /停用/);
    (siteDisabled ? f.state().sites[0] : f.state().accounts[0]).isActive = true;
    await f.api.assignImportDrafts(f.batch([1], 1));
    const submitted = await f.submit();
    (siteDisabled ? f.state().sites[0] : f.state().accounts[0]).isActive = false;
    await assert.rejects(f.api.reviewAssignedImportDraft(submitted.submissionId, "approve", undefined, f.state().drafts[0].version), /停用/);
    assert.equal(f.state().teachers.length, 0);
    assert.equal(f.state().submissions[0].status, "pending");
  }
});

test("members cannot edit another member's draft, source category or image cover", async () => {
  const f = setup();
  await f.assign();
  await assert.rejects(f.api.saveAssignedImportDraft(2, 1, 3, f.memberForm()), /状态或版本/);
  const sourceCover = JSON.parse(f.state().drafts[0].fields)._photoCover;
  const saved = await f.api.saveAssignedImportDraft(1, 1, 3, f.memberForm(1, "save", {
    name: "成员编辑的虚构标题", type: "untrusted-type", photoCover: JSON.stringify({ text: "evil.invalid" }),
  }));
  assert.equal(saved.version, 4);
  const after = JSON.parse(f.state().drafts[0].fields);
  assert.equal(after.name, "成员编辑的虚构标题");
  assert.equal(after.type, "钢琴");
  assert.deepEqual(after._photoCover, sourceCover);
  assert.deepEqual(f.observed.publicWritten, []);
});

test("save permits missing contact while submit requires one and submitted drafts are locked", async () => {
  const f = setup();
  await f.assign();
  await f.api.saveAssignedImportDraft(1, 1, 3, f.memberForm(1, "save", { phone: "" }));
  await assert.rejects(f.submit(), /至少一种联系方式/);
  assert.equal(f.state().drafts[0].status, "assigned");
  await f.api.saveAssignedImportDraft(1, 1, 4, f.memberForm(1, "submit", { phone: "synthetic-contact" }));
  await assert.rejects(f.api.saveAssignedImportDraft(1, 1, 5, f.memberForm()), /状态或版本/);
  assert.equal(f.state().submissions.length, 1);
});

test("assignments do not consume quota; historical usage blocks submissions atomically", async () => {
  const f = setup();
  f.state().submissions = Array.from({ length: 22 }, (_, i) => ({
    id: i + 1, teamAccountId: 1, kind: "create", status: i % 2 ? "pending" : "approved", createdAt: new Date("2026-08-01T00:00:00Z"),
  }));
  await f.assign();
  await assert.rejects(f.submit(), /额度已用完/);
  assert.equal(f.state().drafts[0].status, "assigned");
  assert.equal(f.state().drafts[0].version, 3);
  assert.equal(f.state().submissions.length, 22);
});

test("concurrent submissions cannot exceed the remaining lifetime allowance", async () => {
  const f = setup();
  f.addDraft();
  await f.assign(1);
  await f.assign(2);
  f.state().submissions = Array.from({ length: 21 }, (_, i) => ({
    id: i + 1, teamAccountId: 1, kind: "create", status: "approved", createdAt: new Date("2026-08-01T00:00:00Z"),
  }));
  const results = await Promise.allSettled([f.submit(1), f.submit(2)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.state().submissions.length, 22);
  assert.equal(f.state().drafts.filter(draft => draft.status === "submitted").length, 1);
});

test("return releases quota, preserves photos, and resubmission reuses its one linked record", async () => {
  const f = setup();
  await f.assign();
  await f.submit();
  const photosBefore = f.state().drafts[0].photos;
  await f.api.reviewAssignedImportDraft(1, "return", "请修改虚构说明", 4);
  assert.equal(f.state().drafts[0].status, "returned");
  assert.equal(f.state().drafts[0].photos, photosBefore);
  assert.equal(f.state().submissions[0].status, "rejected");
  assert.equal(f.state().submissions[0].reviewNote, "请修改虚构说明");
  assert.deepEqual(f.observed.privateRemoved, []);
  assert.deepEqual(f.observed.publicWritten, []);
  await f.submit();
  assert.equal(f.state().submissions.length, 1);
  assert.equal(f.state().submissions[0].id, 1);
  assert.equal(f.state().submissions[0].status, "pending");
  assert.equal(f.state().submissions[0].reviewNote, null);
  await assert.rejects(f.api.reviewAssignedImportDraft(1, "approve", undefined, 4), /状态或版本/);
  assert.equal(f.state().teachers.length, 0);
  await f.api.reviewAssignedImportDraft(1, "approve", undefined, 6);
  assert.equal(f.state().teachers.length, 1);
});

test("publication failure rolls back ownership, submission and draft while cleaning only public copies", async () => {
  const f = setup();
  await f.assign();
  await f.submit();
  const before = clone(f.state());
  f.control.failTeacher = true;
  await assert.rejects(f.api.reviewAssignedImportDraft(1, "approve", undefined, 4), error => {
    assert.ok(error instanceof f.core.PartnerImportError);
    assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_DATABASE_FAILURE/);
    return true;
  });
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.observed.publicRemoved, f.observed.publicWritten);
  assert.deepEqual(f.observed.privateRemoved, []);
});

test("a version changed during rendering cannot publish an unseen draft", async () => {
  const f = setup();
  await f.assign();
  await f.submit();
  f.control.beforePublish = () => { f.state().drafts[0].version++; };
  await assert.rejects(f.api.reviewAssignedImportDraft(1, "approve", undefined, 4), /已变更/);
  assert.equal(f.state().teachers.length, 0);
  assert.equal(f.state().submissions[0].status, "pending");
  assert.deepEqual(f.observed.publicRemoved, f.observed.publicWritten);
});

test("ordinary draft review cannot publish an assigned draft or another version of its source post", async () => {
  const f = setup();
  f.addDraft({ postId: 1 });
  await f.assign();
  const form = f.memberForm(1, "publish");
  form.set("confirmPublish", "yes");
  form.set("postRevision", "0");
  await assert.rejects(f.core.reviewImportDraft(1, 3, form), /已变更/);
  const other = f.memberForm(2, "publish");
  other.set("confirmPublish", "yes");
  other.set("postRevision", "0");
  await assert.rejects(f.core.reviewImportDraft(2, 1, other), /公开版本已变化/);
  assert.equal(f.state().teachers.length, 0);
  assert.equal(f.state().drafts[1].status, "pending");
});

test("private photo selection cannot reference another draft or publish during member save", async () => {
  const f = setup();
  await f.assign();
  const form = f.memberForm();
  form.append("keepPhotos", key(99));
  await assert.rejects(f.api.saveAssignedImportDraft(1, 1, 3, form), /图片选择无效/);
  assert.equal(f.state().drafts[0].version, 3);
  assert.deepEqual(f.observed.publicWritten, []);
  const clean = f.memberForm();
  clean.delete("keepPhotos");
  await f.api.saveAssignedImportDraft(1, 1, 3, clean);
  assert.equal(f.state().drafts[0].photos, "[]");
  assert.deepEqual(f.observed.privateRemoved, [key(1)]);
});

test("assignment migration preserves existing drafts and protects account/draft references", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE TeamAccount(id INTEGER PRIMARY KEY); CREATE TABLE TeacherSubmission(id INTEGER PRIMARY KEY); INSERT INTO TeamAccount VALUES(1);");
    db.exec(fs.readFileSync(new URL("../prisma/migrations/20260928000100_add_partner_imports/migration.sql", import.meta.url), "utf8"));
    db.exec("INSERT INTO PartnerImportSource (id,name,origin,rules,updatedAt) VALUES (1,'synthetic','https://partner.example','{}',CURRENT_TIMESTAMP); INSERT INTO PartnerImportedPost(id,sourceId,sourceUrl) VALUES(1,1,'https://partner.example/post/1'); INSERT INTO PartnerImportDraft(id,postId,contentHash,fields,photos,updatedAt) VALUES(1,1,'synthetic','{}','[]',CURRENT_TIMESTAMP);");
    db.exec(fs.readFileSync(new URL("../prisma/migrations/20260928000300_add_partner_import_assignments/migration.sql", import.meta.url), "utf8"));
    assert.deepEqual({ ...db.prepare("SELECT status, teamAccountId, fields, photos FROM PartnerImportDraft WHERE id=1").get() }, { status: "pending", teamAccountId: null, fields: "{}", photos: "[]" });
    db.exec("UPDATE PartnerImportDraft SET teamAccountId=1 WHERE id=1; INSERT INTO TeacherSubmission(id,partnerImportDraftId) VALUES(1,1)");
    assert.throws(() => db.exec("DELETE FROM TeamAccount WHERE id=1"), /FOREIGN KEY/);
    assert.throws(() => db.exec("DELETE FROM PartnerImportDraft WHERE id=1"), /FOREIGN KEY/);
    assert.throws(() => db.exec("INSERT INTO TeacherSubmission(id,partnerImportDraftId) VALUES(2,1)"), /UNIQUE/);
  } finally { db.close(); }
});


test("legacy cover defaults remain identical through save, submission and final publication; explicit off remains off", async () => {
  for (const explicitOff of [false, true]) {
    const f = setup();
    f.state().drafts[0].fields = JSON.stringify({ ...fields, ...(explicitOff ? { _photoCover: null } : {}) });
    await f.assign();
    await f.api.saveAssignedImportDraft(1, 1, 3, f.memberForm());
    const expected = explicitOff ? null : coverApi.DEFAULT_PARTNER_PHOTO_COVER;
    assert.deepEqual(JSON.parse(f.state().drafts[0].fields)._photoCover, expected);
    await f.submit();
    assert.deepEqual(JSON.parse(f.state().drafts[0].fields)._photoCover, expected);
    await f.api.reviewAssignedImportDraft(1, "approve", undefined, 5);
    assert.deepEqual(f.observed.covers, [expected]);
  }
});


test("concurrent initial approvals for different versions admit only one active assignment", async () => {
  const f = setup();
  f.addDraft({ postId: 1 });
  const first = f.batch([1]);
  const second = f.batch([2]);
  const results = await Promise.allSettled([f.api.approveImportDrafts(first), f.api.approveImportDrafts(second)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.state().drafts.filter(draft => draft.status === "ready").length, 1);
  assert.equal(f.state().drafts.filter(draft => draft.status === "pending").length, 1);
});

test("approval and return racing on one submitted version cannot both commit", async () => {
  const f = setup();
  await f.assign();
  await f.submit();
  const results = await Promise.allSettled([
    f.api.reviewAssignedImportDraft(1, "approve", undefined, 4),
    f.api.reviewAssignedImportDraft(1, "return", "虚构审核意见", 4),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  if (f.state().drafts[0].status === "published") {
    assert.equal(f.state().submissions[0].status, "approved");
    assert.equal(f.state().teachers.length, 1);
    assert.equal(f.state().ownerships.length, 1);
  } else {
    assert.equal(f.state().drafts[0].status, "returned");
    assert.equal(f.state().submissions[0].status, "rejected");
    assert.equal(f.state().teachers.length, 0);
    assert.equal(f.state().ownerships.length, 0);
    assert.deepEqual(f.observed.publicRemoved, f.observed.publicWritten);
  }
});

test("approval identifies duplicate versions and leaves every selected draft untouched", async () => {
  const f = setup();
  f.addDraft({ postId: 1 });
  const before = clone(f.state());
  await assert.rejects(f.api.approveImportDrafts(f.batch([1, 2])), /草稿 #1 和 #2 来自同一原帖/);
  assert.deepEqual(f.state(), before);
});

test("approval distinguishes current publication from a deleted historical publication", async () => {
  for (const [teacherId, message] of [[3, /原帖已发布/], [null, /历史发布记录/]]) {
    const f = setup();
    f.addDraft();
    Object.assign(f.state().posts[1], { teacherId, revision: 1 });
    const before = clone(f.state());
    await assert.rejects(f.api.approveImportDrafts(f.batch([1, 2])), error => {
      assert.match(error.message, /草稿 #2/);
      assert.match(error.message, message);
      assert.match(error.message, /本次所选草稿均未通过初审/);
      assert.doesNotMatch(error.message, /partner\.example|虚构服务正文|jpg/);
      return true;
    });
    assert.deepEqual(f.state(), before);
    const select = f.observed.calls.find(call => call[0] === "approval-metadata-select")[1];
    assert.deepEqual(Object.keys(select).sort(), ["drafts", "revision", "teacherId"]);
    assert.deepEqual(Object.keys(select.drafts.select).sort(), ["id", "status"]);
  }
});

test("approval identifies the conflicting draft and its workflow stage without changing either version", async () => {
  for (const [status, label] of [["ready", "待分配"], ["assigned", "成员处理中"], ["returned", "退回修改"], ["submitted", "待终审"]]) {
    const f = setup();
    f.addDraft({ postId: 1, status });
    const before = clone(f.state());
    await assert.rejects(f.api.approveImportDrafts(f.batch()), error => {
      assert.match(error.message, /草稿 #1/);
      assert.ok(error.message.includes("其他版本 #2"));
      assert.ok(error.message.includes(label));
      return true;
    });
    assert.deepEqual(f.state(), before);
  }
});

test("missing and stale draft errors identify the selected row", async () => {
  const f = setup();
  const missing = new FormData();
  missing.set("draft", "99:1");
  await assert.rejects(f.api.approveImportDrafts(missing), /草稿 #99 已不存在/);
  const stale = f.batch();
  f.state().drafts[0].version++;
  await assert.rejects(f.api.approveImportDrafts(stale), /草稿 #1 的状态或版本已变化/);
});

test("the final version claim remains authoritative and a late conflict rolls back earlier approvals", async () => {
  const f = setup();
  f.addDraft();
  const before = clone(f.state());
  f.control.beforeApprovalClaim = where => {
    if (where.id === 2) f.state().drafts[1].version++;
  };
  await assert.rejects(f.api.approveImportDrafts(f.batch([1, 2])), /草稿 #2：状态或版本已变化/);
  assert.deepEqual(f.state(), before);
});

test("final approval retains one lifetime quota charge while return and resubmit reuse that charge", async () => {
  const usage = fixture => {
    const where = quota.getTeamPostUsageWhere(1);
    return fixture.state().submissions.filter(row =>
      row.teamAccountId === where.teamAccountId && row.kind === where.kind &&
      where.status.in.includes(row.status)
    ).length;
  };

  const approved = setup();
  await approved.assign();
  assert.equal(usage(approved), 0);
  const first = await approved.submit();
  const submittedAt = new Date(approved.state().submissions[0].createdAt);
  assert.equal(usage(approved), 1);
  await approved.api.reviewAssignedImportDraft(first.submissionId, "approve", undefined, approved.state().drafts[0].version);
  assert.equal(usage(approved), 1);
  assert.equal(approved.state().submissions.length, 1);
  assert.equal(approved.state().submissions[0].id, first.submissionId);
  assert.equal(approved.state().submissions[0].status, "approved");
  assert.equal(new Date(approved.state().submissions[0].createdAt).getTime(), submittedAt.getTime());

  const returned = setup();
  await returned.assign();
  const initial = await returned.submit();
  assert.equal(usage(returned), 1);
  await returned.api.reviewAssignedImportDraft(initial.submissionId, "return", "虚构退回说明", returned.state().drafts[0].version);
  assert.equal(usage(returned), 0);
  const resubmitted = await returned.submit();
  assert.equal(resubmitted.submissionId, initial.submissionId);
  assert.equal(returned.state().submissions.length, 1);
  assert.equal(returned.state().submissions[0].status, "pending");
  assert.equal(usage(returned), 1);
});
