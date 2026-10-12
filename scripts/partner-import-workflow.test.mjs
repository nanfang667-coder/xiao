import * as coverApi from "../src/lib/partner-import-photo-cover.ts";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import * as crypto from "node:crypto";
import { constants } from "node:fs";
import ts from "typescript";

const origin = "https://partner.example";
const sourceUrl = origin + "/teacher/fictional";
const key = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0") + ".jpg";
const fields = {
  name: "虚构测试帖子", type: "钢琴", city: "测试市", district: "测试区", price: "测试价格",
  services: "完全虚构的测试正文", courseNotes: null, age: null, phone: "fictional-contact",
  wechat: "", qq: null, otherContact: null, address: null,
};

function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, Date, Buffer, TextDecoder, FormData, File, ...globals,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
      return mocks[name];
    },
  });
  return exports;
}

const assignmentReadiness = {
  isPartnerImportAssignmentReady: async () => true,
  requirePartnerImportAssignmentReady: async () => {},
  PartnerImportAssignmentUnavailableError: class extends Error {},
  PARTNER_ASSIGNMENT_UNAVAILABLE: "分配流程尚未启用，请完成数据库升级并重启服务后再试。",
};

const copy = (value) => value == null ? value : structuredClone(value);
function matches(row, where = {}, state) {
  return Object.entries(where).every(([field, value]) => {
    if (field === "drafts") return !state.drafts.some(draft => draft.postId === row.id && matches(draft, value.none, state));
    if (value && typeof value === "object") {
      if ("lt" in value) return row[field] != null && new Date(row[field]) < value.lt;
      if ("in" in value) return value.in.includes(row[field]);
      if ("not" in value) return row[field] !== value.not;
      return Object.entries(value).every(([nested, expected]) => row[nested] === expected);
    }
    return (row[field] ?? null) === value;
  });
}
function apply(row, data) {
  for (const [field, value] of Object.entries(data)) {
    row[field] = value && typeof value === "object" && "increment" in value ? row[field] + value.increment : value;
  }
}

function setup(options = {}) {
  let state = {
    sources: [{ id: 1, name: "虚构合作方", origin, rules: "{}", imageOrigins: "[]" }],
    jobs: [], items: [], posts: [], drafts: [], teachers: [],
  };
  const observed = { fetched: [], privateRemoved: [], publicRemoved: [], publicWritten: [], photoCovers: [], teacherWrites: 0 };
  const control = {
    fields: copy(fields), hashes: ["fictional-image-hash"], links: [sourceUrl],
    failFetch: false, failDraft: false, failTeacher: false, lostLease: false,
    ...options,
  };
  let privateSequence = 0;
  let publicSequence = 0;
  let nextItem = 1;
  let queue = Promise.resolve();
  const prisma = {};
  const table = (name) => ({
    findUnique: async ({ where, include, select }) => {
      const row = state[name].find((entry) => matches(entry, where, state));
      if (!row) return null;
      const value = copy(row);
      if (include?.post || select?.post) value.post = copy(state.posts.find((post) => post.id === row.postId));
      return value;
    },
    updateMany: async ({ where, data }) => {
      const rows = state[name].filter((entry) => matches(entry, where, state));
      for (const row of rows) apply(row, data);
      return { count: rows.length };
    },
    update: async ({ where, data }) => {
      const row = state[name].find((entry) => matches(entry, where, state));
      assert.ok(row, "Missing mocked row");
      apply(row, data);
      return copy(row);
    },
  });
  prisma.partnerImportSource = {
    ...table("sources"),
    create: async ({ data }) => {
      const row = { id: state.sources.length + 1, ...data };
      state.sources.push(row);
      return copy(row);
    },
  };
  prisma.partnerImportJob = {
    ...table("jobs"),
    deleteMany: async ({ where }) => {
      const job = state.jobs.find(row => row.id === where.id);
      assert.equal(where.items.none.status, "processing");
      if (!job || state.items.some(row => row.jobId === job.id && row.status === "processing")) return { count: 0 };
      state.jobs = state.jobs.filter(row => row.id !== job.id);
      state.items = state.items.filter(row => row.jobId !== job.id);
      return { count: 1 };
    },
    create: async ({ data }) => {
      const id = crypto.randomUUID();
      const { items, ...rest } = data;
      state.jobs.push({ id, ...rest });
      for (const item of items.create) {
        state.items.push({ id: nextItem++, jobId: id, ...item, status: "queued", errorCode: null, lockToken: null, lockedAt: null });
      }
      return { id };
    },
  };
  prisma.partnerImportItem = {
    ...table("items"),
    updateMany: async (args) => {
      if (args.where.status === "queued" && args.data.status === "processing") await control.beforeClaim?.();
      return table("items").updateMany(args);
    },
    findFirst: async ({ where }) => {
      const item = state.items.find((row) => matches(row, where, state));
      if (!item) return null;
      const job = state.jobs.find((row) => row.id === item.jobId);
      return { ...copy(item), job: { ...copy(job), source: copy(state.sources.find((row) => row.id === job.sourceId)) } };
    },
    groupBy: async ({ where, by }) => {
      const groups = new Map();
      for (const item of state.items.filter(row => matches(row, where, state))) {
        const values = Object.fromEntries(by.map(field => [field, item[field]]));
        const key = JSON.stringify(values);
        const row = groups.get(key) ?? { ...values, _count: { _all: 0 } };
        row._count._all++;
        groups.set(key, row);
      }
      return [...groups.values()];
    },
  };
  prisma.partnerImportedPost = {
    ...table("posts"),
    upsert: async ({ where, create, update }) => {
      let row = state.posts.find((entry) => matches(entry, where, state));
      if (row) apply(row, update);
      else {
        row = { id: state.posts.length + 1, revision: 0, teacherId: null, ...create };
        state.posts.push(row);
      }
      return copy(row);
    },
  };
  prisma.partnerImportDraft = {
    ...table("drafts"),
    create: async ({ data }) => {
      if (control.failDraft) throw new Error("PRIVATE failed payload");
      assert.equal(state.drafts.some((row) => row.postId === data.postId && row.contentHash === data.contentHash), false);
      const row = { id: state.drafts.length + 1, status: "pending", teamAccountId: null, version: 1, ...data };
      state.drafts.push(row);
      return copy(row);
    },
  };
  prisma.teacher = {
    ...table("teachers"),
    upsert: async ({ where, create, update }) => {
      if (control.failTeacher) throw new Error("PRIVATE failed teacher write");
      observed.teacherWrites++;
      let row = state.teachers.find((entry) => matches(entry, where, state));
      if (row) apply(row, update);
      else {
        row = { id: state.teachers.length + 1, ...create };
        state.teachers.push(row);
      }
      return copy(row);
    },
  };
  prisma.$transaction = async (callback) => {
    let unlock;
    const previous = queue;
    queue = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = copy(state);
    try {
      return await callback(prisma);
    } catch (error) {
      state = snapshot;
      throw error;
    } finally {
      unlock();
    }
  };
  const api = load("src/lib/partner-import.ts", {
    "server-only": {},
    "node:crypto": crypto,
    "./prisma": { prisma },
    "./partner-import-assignment-readiness": assignmentReadiness,
    "./partner-import-errors": load("src/lib/partner-import-errors.ts", {}),
    "./partner-import-declarations": load("src/lib/partner-import-declarations.ts", {}),
    "./partner-import-photo-cover": coverApi,
    "./partner-import-fetch": {
      fetchPartnerResource: async (url, origins, fetchOptions) => {
        observed.fetched.push({ url, origins: [...origins], options: fetchOptions });
        if (url === sourceUrl) await control.beforeDetailFetch?.();
        if (control.fetchError) throw { ...control.fetchError, message: "PRIVATE partner response and URL" };
        if (control.failFetch) throw new Error("PRIVATE partner response and URL");
        return { bytes: control.invalidEncoding ? Buffer.from([0xff]) : Buffer.from("<p>fictional</p>"), contentType: "text/html", url };
      },
    },
    "./partner-import-parser": {
      normalizePartnerImportRules: (value) => value ?? {},
      parsePartnerListing: () => { if (control.listingError) throw { ...control.listingError, message: "PRIVATE listing contents" }; return [...control.links]; },
      parsePartnerDetail: () => ({ fields: copy(control.fields), photoUrls: [origin + "/fictional.png"] }),
    },
    "./partner-import-photos": {
      downloadPartnerPhotos: async () => {
        if (control.lostLease) {
          const active = state.items.find((row) => row.status === "processing");
          if (active) active.lockToken = "new-worker-token";
        }
        return { keys: [key(++privateSequence)], hashes: [...control.hashes] };
      },
      parsePartnerPhotoKeys: (value) => JSON.parse(value),
      publishPartnerPhotos: async (keys, cover) => {
        observed.photoCovers.push(copy(cover));
        const result = keys.map(() => "/uploads/published-" + ++publicSequence + ".jpg");
        observed.publicWritten.push(...result);
        return result;
      },
      removePartnerPrivatePhotos: async (keys) => observed.privateRemoved.push(...keys),
    },
    "./uploaded-photos": { deleteUploadedPhotos: async (value) => observed.publicRemoved.push(...JSON.parse(value)) },
    "./teacher-post-input": load("src/lib/teacher-post-input.ts", {}),
    "./photo": { defaultGradients: () => ["gradient:fictional"], emojiFor: () => "🎹" },
  });

  const deletionApi = load("src/lib/partner-import-job-delete.ts", {
    "server-only": {},
    "./prisma": { prisma },
    "./partner-import": { PartnerImportError: api.PartnerImportError, recoverExpiredItems: api.recoverExpiredItems },
  });
  async function deleteJob(id) {
    const form = new FormData();
    form.set("jobId", id);
    form.set("confirmDelete", "yes");
    return deletionApi.deleteImportJob(form);
  }

  async function createJob(listUrl = origin + "/list?page=1") {
    const form = new FormData();
    form.set("sourceId", "1");
    form.set("listUrl", listUrl);
    return api.createImportJob(form);
  }
  async function importOne() {
    const id = await createJob();
    await api.processImportStep(id);
    return id;
  }
  function reviewForm(draftId = 1, intent = "publish", overrides = {}) {
    const draft = state.drafts.find((row) => row.id === draftId);
    const post = state.posts.find((row) => row.id === draft.postId);
    const form = new FormData();
    for (const [name, value] of Object.entries(JSON.parse(draft.fields))) if (value != null) form.set(name, value);
    form.set("intent", intent);
    form.set("confirmPublish", "yes");
    form.set("postRevision", String(post.revision));
    for (const photo of JSON.parse(draft.photos)) form.append("keepPhotos", photo);
    for (const [name, value] of Object.entries(overrides)) {
      if (value === null) form.delete(name);
      else form.set(name, value);
    }
    return form;
  }
  return { api, control, observed, createJob, importOne, reviewForm, deleteJob, state: () => state };
}

test("single-page import only stores a private pending draft and never touches public teachers", async () => {
  const f = setup();
  const job = await f.importOne();
  const state = f.state();
  assert.equal(state.drafts.length, 1);
  assert.equal(state.drafts[0].status, "pending");
  assert.equal(state.teachers.length, 0);
  assert.equal(f.observed.teacherWrites, 0);
  assert.deepEqual(f.observed.fetched.map((row) => row.url), [origin + "/list?page=1", sourceUrl]);
  assert.equal(f.observed.publicWritten.length, 0);
  assert.equal(f.observed.privateRemoved.length, 0);
  assert.equal((await f.api.getImportProgress(job)).done, true);
});

test("identical imports are skipped even after rejection; changed content creates another pending version", async () => {
  const f = setup();
  await f.importOne();
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1, "reject"));
  const original = copy(f.state().drafts[0]);
  const repeated = await f.importOne();
  assert.equal((await f.api.getImportProgress(repeated)).skipped, 1);
  assert.equal(f.state().drafts.length, 1);
  assert.deepEqual(f.observed.privateRemoved, [key(2)]);
  f.control.fields.services = "另一个完全虚构的修订版本";
  await f.importOne();
  assert.equal(f.state().drafts.length, 2);
  assert.deepEqual(f.state().drafts[0], original);
  assert.equal(f.state().drafts[1].status, "pending");
  assert.equal(f.observed.teacherWrites, 0);
});

test("import failures store only a fixed error code and clean newly downloaded private files", async () => {
  const f = setup({ failDraft: true });
  const id = await f.importOne();
  assert.equal((await f.api.getImportProgress(id)).failed, 1);
  assert.deepEqual(f.observed.privateRemoved, [key(1)]);
  assert.equal(f.state().drafts.length, 0);
  assert.equal(f.state().posts.length, 0, "failed transaction rolls back parent post");
  assert.equal(f.state().items[0].errorCode, "IMPORT_FAILED");
  assert.doesNotMatch(JSON.stringify(f.state().items), /PRIVATE/);
  f.control.failDraft = false;
  await f.api.retryImportJob(id);
  await f.api.processImportStep(id);
  assert.equal((await f.api.getImportProgress(id)).imported, 1);
});

test("fetch failure is redacted and an expired worker cannot commit another worker's lease", async () => {
  const fail = setup();
  const id = await fail.createJob();
  fail.control.failFetch = true;
  await fail.api.processImportStep(id);
  assert.equal(fail.state().items[0].errorCode, "CONNECT_FAILED");
  assert.doesNotMatch(JSON.stringify(fail.state().items), /PRIVATE/);
  const stale = setup({ lostLease: true });
  await stale.importOne();
  assert.equal(stale.state().drafts.length, 0);
  assert.equal(stale.state().posts.length, 0);
  assert.deepEqual(stale.observed.privateRemoved, [key(1)]);
});

test("publish requires explicit confirmation, current draft version and the reviewed public revision", async () => {
  const f = setup();
  await f.importOne();
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm(1, "publish", { confirmPublish: null })), /确认已审查/);
  await assert.rejects(f.api.reviewImportDraft(1, 2, f.reviewForm()), /已变更/);
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm(1, "publish", { postRevision: "9" })), /公开版本已变化/);
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm(1, "publish", { postRevision: null })), /缺少审核版本/);
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm(1, "publish", { postRevision: "" })), /缺少审核版本/);
  assert.equal(f.observed.publicWritten.length, 0);
  assert.equal(f.observed.teacherWrites, 0);
  const result = await f.api.reviewImportDraft(1, 1, f.reviewForm());
  assert.equal(result.teacherId, 1);
  assert.equal(f.state().drafts[0].status, "published");
  assert.equal(f.state().posts[0].revision, 1);
  assert.equal(f.state().teachers.length, 1);
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm()), /已变更/);
  assert.equal(f.observed.teacherWrites, 1);
});

test("parallel publishes commit once and remove only the losing public image copies", async () => {
  const f = setup();
  await f.importOne();
  const results = await Promise.allSettled([
    f.api.reviewImportDraft(1, 1, f.reviewForm()),
    f.api.reviewImportDraft(1, 1, f.reviewForm()),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(f.state().teachers.length, 1);
  assert.equal(f.state().posts[0].revision, 1);
  assert.equal(f.observed.publicRemoved.length, 1);
  const retained = JSON.parse(f.state().teachers[0].photos);
  assert.equal(retained.some((photo) => f.observed.publicRemoved.includes(photo)), false);
});

test("failed publication rolls back draft/post/public records and removes new public files", async () => {
  const f = setup({ failTeacher: true });
  await f.importOne();
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm()));
  assert.equal(f.state().drafts[0].status, "pending");
  assert.equal(f.state().drafts[0].version, 1);
  assert.equal(f.state().posts[0].revision, 0);
  assert.equal(f.state().teachers.length, 0);
  assert.deepEqual(f.observed.publicRemoved, f.observed.publicWritten);
  assert.equal(f.observed.privateRemoved.length, 0, "reviewable private originals survive failed publication");
});

test("saving stays private, removes unselected private photos and checks version and photo ownership", async () => {
  const f = setup();
  await f.importOne();
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm(1, "save", { keepPhotos: key(99) })), /图片选择无效/);
  const form = f.reviewForm(1, "save", { keepPhotos: null, services: "人工审核后的虚构正文", phone: "" });
  const result = await f.api.reviewImportDraft(1, 1, form);
  assert.equal(result.version, 2);
  assert.equal(f.state().drafts[0].status, "pending");
  assert.equal(f.state().drafts[0].photos, "[]");
  assert.deepEqual(f.observed.privateRemoved, [key(1)]);
  assert.equal(f.observed.publicWritten.length, 0);
  assert.equal(f.observed.teacherWrites, 0);
  await assert.rejects(f.api.reviewImportDraft(1, 1, form), /已变更/);
});

test("changed partner content never overwrites published content until a newly reviewed version is published", async () => {
  const f = setup();
  await f.importOne();
  f.control.fields.services = "待审修订二";
  await f.importOne();
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1));
  const originalPublic = copy(f.state().teachers[0]);
  assert.equal(f.state().drafts[1].status, "pending");
  assert.deepEqual(f.state().teachers[0], originalPublic);
  await assert.rejects(f.api.reviewImportDraft(2, 1, f.reviewForm(2)), /确认要替换/);
  await f.api.reviewImportDraft(2, 1, f.reviewForm(2, "publish", { confirmReplace: "yes" }));
  assert.equal(f.state().teachers.length, 1);
  assert.equal(f.state().teachers[0].services, "待审修订二");
  assert.equal(f.state().posts[0].revision, 2);
  assert.deepEqual(f.observed.publicRemoved, JSON.parse(originalPublic.photos));
});

test("source configuration and list URLs must use the same exact HTTPS origin before downloading", async () => {
  const f = setup();
  for (const url of ["http://partner.example/list", "https://different.example/list", "https://partner.example.evil.example/list", "https://u:p@partner.example/list"]) {
    await assert.rejects(f.createJob(url));
  }
  assert.equal(f.observed.fetched.length, 0);
  for (const source of [origin + "/path", "http://partner.example", "https://u:p@partner.example"]) {
    const form = new FormData();
    form.set("name", "虚构来源");
    form.set("origin", source);
    await assert.rejects(f.api.saveImportSource(form));
  }
  const edit = new FormData();
  edit.set("sourceId", "1");
  edit.set("name", "虚构来源");
  edit.set("origin", "https://different.example");
  await assert.rejects(f.api.saveImportSource(edit), /不能更换来源域名/);
});

function setupPhotos({ failCopyAt = 0, failRenderAt = 0, failWriteAt = 0, failOpen = false } = {}) {
  const observed = { saved: [], copied: [], removed: [], read: [], fetched: [], rendered: [], opened: [], written: [], closed: [] };
  const api = load("src/lib/partner-import-photos.ts", {
    "node:crypto": crypto,
    "node:path": path,
    "node:fs": { constants },
    "./partner-import-photo-cover": coverApi,
    "./partner-import-photo-cover-render": { renderPartnerPhotoCover: async (input, cover) => {
      observed.rendered.push({ input: input.toString(), cover: copy(cover) });
      if (observed.rendered.length === failRenderAt) throw new Error("PRIVATE render failure");
      return Buffer.from("covered-fictional");
    } },
    "node:fs/promises": {
      mkdir: async () => {},
      open: async (filename, flags) => {
        if (failOpen) throw Object.assign(new Error("PRIVATE collision"), { code: "EEXIST" });
        observed.opened.push({ filename, flags });
        return {
          writeFile: async bytes => {
            observed.written.push({ filename, bytes: bytes.toString() });
            if (observed.written.length === failWriteAt) throw new Error("PRIVATE disk failure");
          },
          close: async () => { observed.closed.push(filename); },
        };
      },
      readFile: async (filename) => { observed.read.push(filename); return Buffer.from("fictional"); },
      copyFile: async (from, to, flags) => {
        if (observed.copied.length + 1 === failCopyAt) throw new Error("fictional copy failure");
        observed.copied.push({ from, to, flags });
      },
      unlink: async (filename) => { observed.removed.push(filename); },
    },
    "./image-upload": {
      saveUploadedPhotos: async (files, directory) => {
        observed.saved.push({ files, directory });
        return files.map((_, index) => "/uploads/" + key(index + 1));
      },
    },
    "./partner-import-fetch": {
      fetchPartnerResource: async (url, origins, options) => {
        observed.fetched.push({ url, origins: [...origins], options });
        return { bytes: Buffer.from("fictional-raster-bytes"), contentType: "image/png", url };
      },
    },
  }, { process: { cwd: () => path.resolve("fictional-workspace") } });
  return { api, observed };
}

test("downloaded pictures are sent to private image normalization; paths cannot escape private storage", async () => {
  const f = setupPhotos();
  const result = await f.api.downloadPartnerPhotos([origin + "/image.png"], [origin]);
  assert.deepEqual([...result.keys], [key(1)]);
  assert.equal(result.hashes.length, 1);
  assert.equal(f.observed.saved[0].directory, path.join(path.resolve("fictional-workspace"), "storage", "partner-import"));
  assert.equal(f.observed.copied.length, 0);
  assert.equal(f.observed.fetched[0].options.maxBytes, 5 * 1024 * 1024);
  for (const value of ["../secret.jpg", "/etc/passwd", key(1) + ".html", key(1).replace(".jpg", ".svg")]) {
    assert.equal(f.api.isPartnerPhotoKey(value), false);
    await assert.rejects(f.api.readPartnerPrivatePhoto(value), /INVALID_PHOTO/);
    await assert.rejects(f.api.publishPartnerPhotos([value]), /INVALID_PHOTO/);
  }
  assert.equal(f.observed.read.length, 0);
});

test("partial public photo copy failures delete prior copies and expose only a fixed error", async () => {
  const f = setupPhotos({ failCopyAt: 2 });
  await assert.rejects(f.api.publishPartnerPhotos([key(1), key(2)]), /PHOTO_PUBLISH_FAILED/);
  assert.equal(f.observed.copied.length, 1);
  assert.deepEqual(f.observed.removed, [f.observed.copied[0].to]);
  assert.equal(f.observed.copied[0].flags, constants.COPYFILE_EXCL);
});

test("parallel workers claim an import item once and repeated processing never duplicates the draft", async () => {
  const f = setup();
  const job = await f.createJob();
  await Promise.all([f.api.processImportStep(job), f.api.processImportStep(job)]);
  await f.api.processImportStep(job);
  assert.equal(f.state().drafts.length, 1);
  assert.equal(f.observed.fetched.filter((row) => row.url === sourceUrl).length, 1);
  assert.equal(f.observed.teacherWrites, 0);
});

test("parallel publication of different drafts for the same post preserves the losing draft for fresh review", async () => {
  const f = setup();
  await f.importOne();
  f.control.fields.services = "并行审核的虚构修订版本";
  await f.importOne();
  const results = await Promise.allSettled([
    f.api.reviewImportDraft(1, 1, f.reviewForm(1)),
    f.api.reviewImportDraft(2, 1, f.reviewForm(2)),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(f.state().drafts.filter((row) => row.status === "published").length, 1);
  const pending = f.state().drafts.find((row) => row.status === "pending");
  assert.ok(pending);
  assert.equal(pending.version, 1);
  assert.equal(f.state().posts[0].revision, 1);
  assert.equal(f.state().teachers.length, 1);
  assert.equal(f.observed.publicRemoved.length, 1);
});

test("list failures distinguish access errors, parsing and encoding without disclosing source data", async () => {
  for (const [options, pattern] of [
    [{ fetchError: { code: "HTTP_STATUS", status: 403 } }, /HTTP 403/],
    [{ fetchError: { code: "DNS_FAILED" } }, /无法解析/],
    [{ listingError: { code: "LISTING_NO_MATCH" } }, /帖子链接规则/],
    [{ listingError: { code: "TOO_MANY_POSTS" } }, /超过 50/],
    [{ invalidEncoding: true }, /编码/],
  ]) {
    const f = setup(options);
    await assert.rejects(f.createJob(), error => {
      assert.match(error.message, pattern);
      assert.doesNotMatch(error.message, /PRIVATE|partner\.example/);
      return true;
    });
    assert.equal(f.state().jobs.length, 0);
    assert.equal(f.observed.teacherWrites, 0);
  }
});

test("failed task progress aggregates fixed error codes and never exposes foreign exception text", async () => {
  const f = setup({ links: [sourceUrl, sourceUrl + "-2", sourceUrl + "-3"] });
  const id = await f.createJob();
  f.control.fetchError = { code: "TIMEOUT" };
  await f.api.processImportStep(id);
  f.control.fetchError = { code: "TLS_FAILED" };
  await f.api.processImportStep(id);
  f.control.fetchError = { code: "PRIVATE partner response and URL" };
  const progress = await f.api.processImportStep(id);
  assert.equal(progress.total, 3);
  assert.equal(progress.failed, 3);
  assert.equal(progress.done, true);
  assert.deepEqual(JSON.parse(JSON.stringify(progress.failures)), [
    {code:"TIMEOUT", count:1}, {code:"TLS_FAILED", count:1}, {code:"CONNECT_FAILED", count:1},
  ]);
  assert.doesNotMatch(JSON.stringify(progress), /PRIVATE|partner\.example/);
  assert.equal(f.observed.teacherWrites, 0);
});

test("saving an existing pending draft strips declaration tails without changing the form or selected photos", async () => {
  const f = setup();
  await f.importOne();
  const draft = f.state().drafts[0];
  draft.photos = JSON.stringify([key(1), key(2)]);
  const form = f.reviewForm(1, "save", {
    services: "虚构服务内容\n声明信息\n虚构网站声明",
    courseNotes: "虚构课程说明\n声明信息：虚构附加声明",
    address: "虚构地址\n声明信息\n虚构地址尾注",
  });
  const submitted = [...form.entries()];
  await f.api.reviewImportDraft(1, 1, form);
  const saved = JSON.parse(f.state().drafts[0].fields);
  assert.equal(saved.services, "虚构服务内容");
  assert.equal(saved.courseNotes, "虚构课程说明");
  assert.equal(saved.address, "虚构地址");
  assert.deepEqual([...form.entries()], submitted);
  assert.deepEqual(JSON.parse(f.state().drafts[0].photos), [key(1), key(2)]);
  assert.equal(f.state().drafts[0].status, "pending");
  assert.deepEqual(f.observed.privateRemoved, []);
  assert.equal(f.observed.teacherWrites, 0);
});

test("publication cleans declaration tails before storing the reviewed draft and public fields", async () => {
  const f = setup();
  await f.importOne();
  const form = f.reviewForm(1, "publish", {
    services: "虚构已审核服务\n声明信息\n虚构来源声明",
    phone: "fictional-contact\n声明信息：虚构网站联系声明",
    age: "虚构年龄\n声明信息：虚构字段声明",
  });
  await f.api.reviewImportDraft(1, 1, form);
  assert.equal(f.state().teachers.length, 1);
  const teacher = f.state().teachers[0];
  assert.equal(teacher.services, "虚构已审核服务");
  assert.equal(teacher.phone, "fictional-contact");
  assert.equal(teacher.age, "虚构年龄");
  const saved = JSON.parse(f.state().drafts[0].fields);
  assert.equal(saved.services, teacher.services);
  assert.equal(saved.phone, teacher.phone);
  assert.deepEqual(JSON.parse(f.state().drafts[0].photos), [key(1)]);
});

test("declaration-only services cannot pass save or publication validation", async () => {
  for (const intent of ["save", "publish"]) {
    const f = setup();
    await f.importOne();
    const before = copy(f.state());
    const form = f.reviewForm(1, intent, { services: "声明信息\n虚构网站声明" });
    await assert.rejects(f.api.reviewImportDraft(1, 1, form), /正文/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.observed.teacherWrites, 0);
    assert.deepEqual(f.observed.publicWritten, []);
    assert.deepEqual(f.observed.privateRemoved, []);
  }
});

test("a declaration-only contact cannot satisfy publication but can be cleared in a pending save", async () => {
  const f = setup();
  await f.importOne();
  const form = f.reviewForm(1, "publish", {
    phone: "声明信息：虚构网站联系方式",
    wechat: "", qq: "", otherContact: "",
  });
  const before = copy(f.state());
  await assert.rejects(f.api.reviewImportDraft(1, 1, form), /联系方式/);
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.observed.publicWritten, []);
  form.set("intent", "save");
  await f.api.reviewImportDraft(1, 1, form);
  assert.equal(JSON.parse(f.state().drafts[0].fields).phone, "");
  assert.equal(f.state().drafts[0].status, "pending");
  assert.equal(f.observed.teacherWrites, 0);
});

test("rejecting a pending draft does not clean stored fields or require declaration-only text to validate", async () => {
  const f = setup();
  await f.importOne();
  const draft = f.state().drafts[0];
  draft.fields = JSON.stringify({ ...fields, services: "声明信息\n虚构网站声明", phone: "" });
  const originalFields = draft.fields;
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1, "reject"));
  assert.equal(f.state().drafts[0].fields, originalFields);
  assert.equal(f.state().drafts[0].status, "rejected");
  assert.deepEqual(f.observed.publicWritten, []);
  assert.deepEqual(f.observed.privateRemoved, []);
});

const syntheticCover = { text: "site.example", position: "bottom", align: "center", widthPercent: 100, heightPercent: 15 };

test("saving a cover stores only private metadata and preserves original keys without rendering", async () => {
  const f = setup();
  await f.importOne();
  const form = f.reviewForm(1, "save", { photoCover: JSON.stringify(syntheticCover) });
  await f.api.reviewImportDraft(1, 1, form);
  assert.deepEqual(JSON.parse(f.state().drafts[0].fields)._photoCover, syntheticCover);
  assert.deepEqual(JSON.parse(f.state().drafts[0].photos), [key(1)]);
  assert.deepEqual(f.observed.publicWritten, []);
  assert.deepEqual(f.observed.privateRemoved, []);
  assert.deepEqual(f.observed.photoCovers, []);
  assert.equal(f.observed.teacherWrites, 0);
});
test("publication uses the exact saved cover but never writes its private metadata to the public record", async () => {
  const f = setup();
  await f.importOne();
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1, "save", { photoCover: JSON.stringify(syntheticCover) }));
  // Missing field is an old client: retain saved configuration.
  await f.api.reviewImportDraft(1, 2, f.reviewForm(1, "publish"));
  assert.deepEqual(f.observed.photoCovers, [syntheticCover]);
  assert.deepEqual(JSON.parse(f.state().drafts[0].fields)._photoCover, syntheticCover);
  assert.equal(Object.hasOwn(f.state().teachers[0], "_photoCover"), false);
  assert.deepEqual(f.observed.privateRemoved, []);
});
test("turning coverage off clears saved settings while preserving original photo files", async () => {
  const f = setup();
  await f.importOne();
  f.state().drafts[0].fields = JSON.stringify({ ...fields, _photoCover: syntheticCover });
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1, "save", { photoCover: "null" }));
  assert.equal(JSON.parse(f.state().drafts[0].fields)._photoCover, null);
  assert.deepEqual(f.observed.privateRemoved, []);
  await f.api.reviewImportDraft(1, 2, f.reviewForm());
  assert.deepEqual(f.observed.photoCovers, [null]);
});
test("invalid submitted or stored cover fails without writes, rendering or public output", async () => {
  for (const invalid of [JSON.stringify({ ...syntheticCover, heightPercent: 99 }), "broken", "[]"]) {
    const f = setup();
    await f.importOne();
    const before = copy(f.state());
    await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm(1, "save", { photoCover: invalid })), /图片覆盖设置无效/);
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.observed.publicWritten, []);
    assert.deepEqual(f.observed.photoCovers, []);
  }
  const f = setup();
  await f.importOne();
  f.state().drafts[0].fields = JSON.stringify({ ...fields, _photoCover: { invalid: true } });
  await assert.rejects(f.api.reviewImportDraft(1, 1, f.reviewForm()), /图片覆盖设置无效/);
  assert.deepEqual(f.observed.publicWritten, []);
});
test("covered public copies are cleaned on failed publication while draft settings and originals survive", async () => {
  const f = setup({ failTeacher: true });
  await f.importOne();
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1, "save", { photoCover: JSON.stringify(syntheticCover) }));
  await assert.rejects(f.api.reviewImportDraft(1, 2, f.reviewForm()));
  assert.deepEqual(f.observed.photoCovers, [syntheticCover]);
  assert.deepEqual(f.observed.publicRemoved, f.observed.publicWritten);
  assert.deepEqual(f.observed.privateRemoved, []);
  assert.deepEqual(JSON.parse(f.state().drafts[0].fields)._photoCover, syntheticCover);
  assert.equal(f.state().drafts[0].status, "pending");
});

test("covered photo publication writes new exclusive files, keeps originals and uses the validated renderer config", async () => {
  const f = setupPhotos();
  const result = await f.api.publishPartnerPhotos([key(1), key(2)], syntheticCover);
  assert.equal(result.length, 2);
  assert.equal(f.observed.copied.length, 0);
  assert.deepEqual(f.observed.rendered.map(row => row.cover), [syntheticCover, syntheticCover]);
  assert.ok(f.observed.opened.every(row => row.flags === "wx" && row.filename.includes(path.join("public", "uploads"))));
  assert.ok(f.observed.read.every(filename => filename.includes(path.join("storage", "partner-import"))));
  assert.ok(f.observed.written.every(row => row.bytes === "covered-fictional"));
  assert.equal(f.observed.closed.length, 2);
  assert.deepEqual(f.observed.removed, []);
});
test("render and partial write failures clean only newly created covered files", async () => {
  for (const options of [{ failRenderAt: 2 }, { failWriteAt: 2 }, { failOpen: true }]) {
    const f = setupPhotos(options);
    await assert.rejects(f.api.publishPartnerPhotos([key(1), key(2)], syntheticCover), /^Error: PHOTO_PUBLISH_FAILED$/);
    assert.deepEqual(f.observed.removed, f.observed.opened.map(row => row.filename));
    assert.equal(f.observed.closed.length, f.observed.opened.length);
    assert.ok(f.observed.removed.every(filename => filename.includes(path.join("public", "uploads"))));
  }
});

test("new imports store the default cover privately without changing the source content hash", async () => {
  const f = setup();
  await f.importOne();
  const draft = f.state().drafts[0];
  assert.deepEqual(JSON.parse(draft.fields)._photoCover, coverApi.DEFAULT_PARTNER_PHOTO_COVER);
  const hash = crypto.createHash("sha256").update(JSON.stringify({ fields: f.control.fields, photos: f.control.hashes })).digest("hex");
  assert.equal(draft.contentHash, hash);
  assert.deepEqual(f.observed.photoCovers, []);
  assert.deepEqual(f.observed.publicWritten, []);
  assert.deepEqual(f.observed.privateRemoved, []);
});
test("saving a legacy pending draft applies the default cover while keeping manually entered contact and price", async () => {
  const f = setup();
  await f.importOne();
  f.state().drafts[0].fields = JSON.stringify(fields);
  const manual = { price: "手填价格", phone: "manual-phone", wechat: "manual-wechat", qq: "10001", otherContact: "manual-contact" };
  await f.api.reviewImportDraft(1, 1, f.reviewForm(1, "save", manual));
  const saved = JSON.parse(f.state().drafts[0].fields);
  assert.deepEqual(saved._photoCover, coverApi.DEFAULT_PARTNER_PHOTO_COVER);
  for (const [key, value] of Object.entries(manual)) assert.equal(saved[key], value);
  await f.api.reviewImportDraft(1, 2, f.reviewForm());
  for (const [key, value] of Object.entries(manual)) assert.equal(f.state().teachers[0][key], value);
  assert.deepEqual(f.observed.photoCovers, [coverApi.DEFAULT_PARTNER_PHOTO_COVER]);
});

test("history deletion preserves imported drafts, private photos and duplicate detection", async () => {
  const f = setup();
  const first = await f.importOne();
  const originalDrafts = copy(f.state().drafts);
  const originalPosts = copy(f.state().posts);
  assert.equal((await f.deleteJob(first)).deletedJobId, first);
  assert.equal(f.state().jobs.length, 0);
  assert.equal(f.state().items.length, 0);
  assert.deepEqual(f.state().drafts, originalDrafts);
  assert.deepEqual(f.state().posts, originalPosts);
  assert.deepEqual(f.observed.privateRemoved, []);
  const repeated = await f.importOne();
  assert.equal((await f.api.getImportProgress(repeated)).skipped, 1);
  assert.deepEqual(f.state().drafts, originalDrafts);
  assert.equal(f.observed.teacherWrites, 0);
});

test("deletion after a worker selects queued work prevents its claim and detail download", async () => {
  const f = setup();
  const id = await f.createJob();
  f.control.beforeClaim = async () => {
    f.control.beforeClaim = undefined;
    await f.deleteJob(id);
  };
  await assert.rejects(f.api.processImportStep(id), /任务不存在/);
  assert.deepEqual(f.observed.fetched.map(row => row.url), [origin + "/list?page=1"]);
  assert.equal(f.state().drafts.length, 0);
  assert.equal(f.state().posts.length, 0);
  assert.equal(f.state().items.length, 0);
  assert.deepEqual(f.observed.privateRemoved, []);
});

test("deletion while a worker owns the item is refused; after it finishes only history is removed", async () => {
  const f = setup();
  const id = await f.createJob();
  let checked = false;
  f.control.beforeDetailFetch = async () => {
    await assert.rejects(f.deleteJob(id), /处理/);
    assert.equal(f.state().jobs.length, 1);
    assert.equal(f.state().items[0].status, "processing");
    checked = true;
  };
  await f.api.processImportStep(id);
  assert.equal(checked, true);
  assert.equal(f.state().drafts.length, 1);
  await f.deleteJob(id);
  assert.equal(f.state().jobs.length, 0);
  assert.equal(f.state().drafts.length, 1);
  assert.deepEqual(f.observed.privateRemoved, []);
});

test("expired work can be deleted and its resumed worker cannot create a draft or retain photos", async () => {
  const f = setup();
  const id = await f.createJob();
  f.control.beforeDetailFetch = async () => {
    f.state().items[0].lockedAt = new Date(Date.now() - 11 * 60 * 1000);
    await f.deleteJob(id);
  };
  await assert.rejects(f.api.processImportStep(id), /任务不存在/);
  assert.equal(f.state().jobs.length, 0);
  assert.equal(f.state().items.length, 0);
  assert.equal(f.state().posts.length, 0);
  assert.equal(f.state().drafts.length, 0);
  assert.deepEqual(f.observed.privateRemoved, [key(1)]);
  assert.equal(f.observed.teacherWrites, 0);
});
