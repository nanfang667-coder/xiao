import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Source-only loader: authentication, database, storage and rendering dependencies
// are explicit in-memory fakes. No environment, real content or network is read.
function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URL, Request, Response, FormData, Uint8Array, Buffer, ...globals,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
      return mocks[name];
    },
  });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const element = (type, props, key) => ({ type, props, key });
const jsx = { jsx: element, jsxs: element };
const visibleStatuses = ["assigned", "returned", "submitted", "published"];
const privateMarker = "SYNTHETIC_PRIVATE_CONTENT";
const photoKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg";
const otherPhotoKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg";
const fields = {
  name: privateMarker, type: "钢琴", services: "虚构服务", courseNotes: "虚构介绍",
  city: "虚构市", district: "", price: "", age: null, phone: "", wechat: "", qq: null,
  otherContact: null, address: null,
};
const cover = { text: "synthetic.example", position: "bottom", align: "center", widthPercent: 100, heightPercent: 15 };
const coverApi = load("src/lib/partner-import-photo-cover.ts", {
  "./site-config.ts": { SITE_URL: "https://synthetic.example" },
});
class PartnerImportError extends Error {}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...Object.values(tree).flatMap(nodes)];
}
function assertOwnerWhere(where, withId = true) {
  assert.deepEqual(plain(where), {
    ...(withId ? { id: 1 } : {}), teamAccountId: 7, status: { in: visibleStatuses },
  });
}
const note = "虚构退回说明";

function actionFixture({ authorized = true, error, submit = false, ready = true } = {}) {
  const calls = [];
  const api = load("src/app/team/assigned/actions.ts", {
    "next/cache": { revalidatePath: value => calls.push(["refresh", value]) },
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => ready },
    "@/lib/team-auth": { requireTeamAccount: async () => {
      calls.push("auth");
      if (!authorized) throw new Error("UNAUTHORIZED");
      return { id: 7, siteId: "synthetic-site" };
    } },
    "@/lib/partner-import": { PartnerImportError },
    "@/lib/partner-import-assignment": { saveAssignedImportDraft: async (...args) => {
      calls.push(["save", ...args.slice(0, 3), [...args[3].entries()]]);
      if (error) throw error;
      return { version: 5, message: submit ? "虚构提交成功" : "虚构保存成功", ...(submit ? { submissionId: 12 } : {}) };
    } },
  });
  return { api, calls };
}

test("team save authenticates first and always uses the account from the session", async () => {
  const f = actionFixture();
  const form = new FormData();
  form.set("teamAccountId", "999");
  form.set("intent", "save");
  const result = await f.api.saveAssignedPartnerDraft(1, 4, { teamAccountId: 999 }, form);
  assert.equal(result.version, 5);
  assert.equal(result.submitted, false);
  assert.deepEqual(f.calls.slice(0, 2), ["auth", ["save", 7, 1, 4, [...form.entries()]]]);
  assert.deepEqual(f.calls.slice(2), [
    ["refresh", "/team"], ["refresh", "/team/assigned"], ["refresh", "/team/assigned/1"],
    ["refresh", "/adminzhangzhang/partner-import"], ["refresh", "/adminzhangzhang/submissions"],
  ]);
});

test("a successful team submit returns the frozen-state signal and submission id without publishing", async () => {
  const f = actionFixture({ submit: true });
  const form = new FormData();
  form.set("intent", "submit");
  const result = await f.api.saveAssignedPartnerDraft(1, 4, {}, form);
  assert.deepEqual(plain(result), { version: 5, message: "虚构提交成功", submitted: true, submissionId: 12 });
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "refresh" && call[1] === "/"), false);
});

test("unauthenticated team mutations cannot reach the core or revalidation", async () => {
  const f = actionFixture({ authorized: false });
  await assert.rejects(f.api.saveAssignedPartnerDraft(1, 4, {}, new FormData()), /UNAUTHORIZED/);
  assert.deepEqual(f.calls, ["auth"]);
});

test("expected mutation errors are shown while unknown exception content is hidden", async () => {
  for (const [error, expected] of [
    [new PartnerImportError("此任务已变更，请刷新。"), "此任务已变更，请刷新。"],
    [new Error(privateMarker), "保存失败，请刷新页面后重试。"],
  ]) {
    const f = actionFixture({ error });
    const result = await f.api.saveAssignedPartnerDraft(1, 4, {}, new FormData());
    assert.equal(result.error, expected);
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
    assert.equal(f.calls.length, 2);
  }
});

function listFixture({ authorized = true, empty = false, ready = true } = {}) {
  const calls = [];
  const records = empty ? [] : Array.from({ length: 22 }, (_, index) => ({
    id: index + 1, status: index === 0 ? "returned" : "assigned",
    updatedAt: new Date("2026-01-01T00:00:00Z"), submission: { reviewNote: index === 0 ? note : null },
    fields: privateMarker, photos: [privateMarker],
  }));
  const api = load("src/app/team/assigned/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: "Link", __esModule: true },
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => ready },
    "@/lib/team-auth": { requireTeamAccount: async () => {
      calls.push("auth");
      if (!authorized) throw new Error("UNAUTHORIZED");
      return { id: 7 };
    } },
    "@/lib/pagination": load("src/lib/pagination.ts", {}),
    "@/lib/prisma": { prisma: { partnerImportDraft: {
      count: async ({ where }) => { calls.push("count"); assertOwnerWhere(where, false); return records.length; },
      findMany: async args => {
        calls.push(["findMany", plain(args)]);
        assertOwnerWhere(args.where, false);
        assert.deepEqual(plain(args.select), { id: true, status: true, updatedAt: true, submission: { select: { reviewNote: true } } });
        assert.equal(args.take, 20);
        assert.deepEqual(plain(args.orderBy), [{ updatedAt: "desc" }, { id: "desc" }]);
        return records.slice(args.skip, args.skip + args.take);
      },
    } } },
  });
  return { api, calls, render: page => api.default({ searchParams: Promise.resolve({ page }) }) };
}

test("the team list queries only owner-scoped metadata and renders no post fields or photos", async () => {
  const f = listFixture();
  const tree = await f.render("1");
  assert.equal(nodes(tree).filter(node => node.type === "article").length, 20);
  assert.equal(JSON.stringify(tree).includes(privateMarker), false);
  assert.equal(JSON.stringify(tree).includes(note), true);
  assert.equal(nodes(tree).some(node => node.type === "Link" && node.props.href === "/team/assigned?page=2"), true);
  assert.equal(f.api.dynamic, "force-dynamic");
  assert.deepEqual(plain(f.api.metadata.robots), { index: false, follow: false });
});

test("team list pagination clamps to the last page after deletions", async () => {
  const f = listFixture();
  const tree = await f.render("9999");
  assert.equal(nodes(tree).filter(node => node.type === "article").length, 2);
  assert.equal(f.calls[2][1].skip, 20);
  assert.equal(nodes(tree).some(node => node.type === "Link" && node.props.href === "/team/assigned?page=3"), false);
});

test("empty team lists render an empty state without unrelated records", async () => {
  const f = listFixture({ empty: true });
  const tree = await f.render("1");
  assert.match(JSON.stringify(tree), /暂时没有分配给你的帖子/);
  assert.equal(nodes(tree).filter(node => node.type === "article").length, 0);
});

test("team list authentication precedes parameters and database access", async () => {
  const f = listFixture({ authorized: false });
  await assert.rejects(f.api.default({ searchParams: { then() { throw new Error("EARLY_PARAMETERS"); } } }), /UNAUTHORIZED/);
  assert.deepEqual(f.calls, ["auth"]);
});

function photosApi(calls, { failFile = false } = {}) {
  return load("src/lib/partner-import-photos.ts", {
    "node:crypto": {},
    "node:fs/promises": { readFile: async filename => {
      calls.push(["readFile", filename]);
      if (failFile) throw new Error(privateMarker);
      return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    } },
    "node:path": path,
    "node:fs": { constants: {} },
    "./image-upload": {},
    "./partner-import-fetch": {},
    "./partner-import-photo-cover": {},
    "./partner-import-photo-cover-render": {},
  }, { process: { cwd: () => path.resolve("synthetic-workspace") } });
}

function detailFixture({ authorized = true, ready = true, owner = 7, status = "assigned", rawFields = JSON.stringify({ ...fields, _photoCover: cover }), photos = JSON.stringify([photoKey]) } = {}) {
  const calls = [];
  const missing = new Error("NOT_FOUND");
  const api = load("src/app/team/assigned/[id]/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: "Link", __esModule: true },
    "next/navigation": { notFound() { calls.push("notFound"); throw missing; } },
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => ready },
    "@/lib/team-auth": { requireTeamAccount: async () => {
      calls.push("auth");
      if (!authorized) throw new Error("UNAUTHORIZED");
      return { id: 7 };
    } },
    "@/lib/prisma": { prisma: { partnerImportDraft: { findFirst: async args => {
      calls.push(["findFirst", plain(args)]);
      assertOwnerWhere(args.where);
      if (owner !== args.where.teamAccountId || !args.where.status.in.includes(status)) return null;
      return { id: 1, status, fields: rawFields, photos, version: 4, baseRevision: 0,
        post: { revision: 0, teacherId: status === "published" ? 42 : null }, submission: { reviewNote: note } };
    } } } },
    "@/lib/partner-import-photos": photosApi(calls),
    "@/lib/partner-import-photo-cover": coverApi,
    "@/app/adminzhangzhang/partner-import/DraftForm": { DraftForm: "DraftForm" },
    "../actions": { saveAssignedPartnerDraft: "team-action" },
  });
  return { api, calls, missing, render: (id = "1") => api.default({ params: Promise.resolve({ id }) }) };
}

test("assigned and returned details use the shared team editor with owner fields and a return note", async () => {
  for (const status of ["assigned", "returned"]) {
    const f = detailFixture({ status });
    const tree = await f.render();
    const form = nodes(tree).find(node => node.type === "DraftForm");
    assert.ok(form);
    assert.equal(form.props.mode, "team");
    assert.equal(form.props.onReview, "team-action");
    assert.equal(form.props.status, status);
    assert.equal(form.props.reviewNote, note);
    assert.equal(form.props.fields.name, privateMarker);
    assert.deepEqual(plain(form.props.photos), [photoKey]);
    assert.deepEqual(plain(form.props.photoCover), cover);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "readFile"), false);
  }
});

test("submitted and published details preserve status so the shared form remains read-only", async () => {
  for (const status of ["submitted", "published"]) {
    const f = detailFixture({ status });
    const tree = await f.render();
    assert.equal(nodes(tree).find(node => node.type === "DraftForm").props.status, status);
    assert.match(JSON.stringify(tree), status === "submitted" ? /审核期间不能修改/ : /后续修改请联系管理员/);
  }
});

test("other members and inaccessible draft states return notFound without reading photos", async () => {
  for (const options of [{ owner: 8 }, { status: "pending" }, { status: "ready" }, { status: "rejected" }]) {
    const f = detailFixture(options);
    await assert.rejects(f.render(), error => error === f.missing);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "readFile"), false);
  }
});

test("draft detail authentication and strict numeric ids precede database access", async () => {
  const denied = detailFixture({ authorized: false });
  await assert.rejects(denied.api.default({ params: { then() { throw new Error("EARLY_PARAMETERS"); } } }), /UNAUTHORIZED/);
  assert.deepEqual(denied.calls, ["auth"]);
  for (const id of ["0", "-1", "01", "1.5", "1e0", "../1", "9007199254740992"]) {
    const f = detailFixture();
    await assert.rejects(f.render(id), error => error === f.missing);
    assert.deepEqual(f.calls, ["auth", "notFound"]);
  }
});

test("unreadable assigned content shows a fixed message and does not render an editor", async () => {
  for (const options of [
    { rawFields: privateMarker }, { photos: privateMarker },
    { rawFields: JSON.stringify({ ...fields, _photoCover: { secret: privateMarker } }) },
  ]) {
    const f = detailFixture(options);
    const tree = await f.render();
    assert.equal(nodes(tree).some(node => node.type === "DraftForm"), false);
    assert.equal(JSON.stringify(tree).includes(privateMarker), false);
    assert.match(JSON.stringify(tree), /帖子资料暂时无法读取/);
  }
});

test("assigned default cover and explicit no-cover settings retain their separate meanings", async () => {
  const f = detailFixture({ rawFields: JSON.stringify(fields) });
  const defaultForm = nodes(await f.render()).find(node => node.type === "DraftForm");
  assert.deepEqual(plain(defaultForm.props.photoCover), cover);
  const disabled = detailFixture({ rawFields: JSON.stringify({ ...fields, _photoCover: null }) });
  assert.equal(nodes(await disabled.render()).find(node => node.type === "DraftForm").props.photoCover, null);
});

function routeFixture({ authorized = true, ready = true, authError = false, owner = 7, status = "assigned",
  rawFields = JSON.stringify({ ...fields, _photoCover: cover }), photos = JSON.stringify([photoKey]),
  failDb = false, failFile = false, failRender = false } = {}) {
  const calls = [];
  const api = load("src/app/team/assigned/[id]/photos/[filename]/route.ts", {
    "@/lib/partner-import-assignment-readiness": { isPartnerImportAssignmentReady: async () => ready },
    "@/lib/team-auth": { getTeamAccount: async () => {
      calls.push("auth");
      if (authError) throw new Error(privateMarker);
      return authorized ? { id: 7 } : null;
    } },
    "@/lib/prisma": { prisma: { partnerImportDraft: { findFirst: async args => {
      calls.push(["findFirst", plain(args)]);
      assertOwnerWhere(args.where);
      assert.deepEqual(plain(args.select), { photos: true, fields: true, status: true });
      if (failDb) throw new Error(privateMarker);
      if (owner !== args.where.teamAccountId || !args.where.status.in.includes(status)) return null;
      return { fields: rawFields, photos, status };
    } } } },
    "@/lib/partner-import-photos": photosApi(calls, { failFile }),
    "@/lib/partner-import-photo-cover": coverApi,
    "@/lib/partner-import-photo-cover-render": { renderPartnerPhotoCover: async (bytes, configuration) => {
      calls.push(["renderCover", plain(configuration)]);
      assert.deepEqual([...bytes], [0xff, 0xd8, 0xff, 0xd9]);
      if (failRender) throw new Error(privateMarker);
      return Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);
    } },
  });
  const get = (id = "1", filename = photoKey, query = "") => api.GET(new Request("https://synthetic.example/team/assigned/1/photos/" + filename + query), {
    params: Promise.resolve({ id, filename }),
  });
  return { api, calls, get };
}
function assertPrivateHeaders(response) {
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("signed-out photo requests stop before params, database or disk with private response headers", async () => {
  const f = routeFixture({ authorized: false });
  const response = await f.api.GET(new Request("https://synthetic.example/team/assigned/1/photos/x"), {
    params: { then() { throw new Error("EARLY_PARAMETERS"); } },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(f.calls, ["auth"]);
  assertPrivateHeaders(response);
});

test("photo routes reject invalid IDs and traversal filenames before database access", async () => {
  for (const id of ["0", "01", "-1", "1.5", "1e0", "9007199254740992"]) {
    const f = routeFixture();
    const response = await f.get(id);
    assert.equal(response.status, 404);
    assert.deepEqual(f.calls, ["auth"]);
    assertPrivateHeaders(response);
  }
  for (const filename of ["../" + photoKey, "..\\" + photoKey, "%2e%2e%2f" + photoKey, "x.svg", "/uploads/" + photoKey]) {
    const f = routeFixture();
    const response = await f.get("1", filename);
    assert.equal(response.status, 404);
    assert.deepEqual(f.calls, ["auth"]);
    assertPrivateHeaders(response);
  }
});

test("photo ownership, workflow status and selected photo membership are enforced before reading bytes", async () => {
  for (const options of [{ owner: 8 }, { status: "ready" }, { status: "pending" }, { status: "rejected" }, { photos: JSON.stringify([otherPhotoKey]) }]) {
    const f = routeFixture(options);
    const response = await f.get();
    assert.equal(response.status, 404);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "readFile"), false);
    assertPrivateHeaders(response);
  }
});

test("permitted photo states serve only the stored cover even when query parameters attempt to disable it", async () => {
  for (const status of visibleStatuses) {
    for (const query of ["", "?cover=off", "?cover=%7B%22text%22%3A%22attacker.example%22%7D"]) {
      const f = routeFixture({ status });
      const response = await f.get("1", photoKey, query);
      assert.equal(response.status, 200);
      assertPrivateHeaders(response);
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      assert.equal(response.headers.get("content-length"), "5");
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xd8, 1, 0xff, 0xd9]);
      assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === "renderCover"), ["renderCover", cover]);
      assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === "readFile").length, 1);
    }
  }
});

test("only an explicit saved null cover serves original bytes", async () => {
  const f = routeFixture({ rawFields: JSON.stringify({ ...fields, _photoCover: null }) });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "renderCover"), false);
  assertPrivateHeaders(response);
});

test("photo errors stay fixed and private without raw exception details", async () => {
  for (const options of [
    { authError: true }, { failDb: true }, { failFile: true }, { failRender: true },
    { photos: privateMarker }, { rawFields: JSON.stringify({ _photoCover: { secret: privateMarker } }) },
  ]) {
    const f = routeFixture(options);
    const response = await f.get();
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
    assertPrivateHeaders(response);
  }
});

test("the team dashboard exposes one assigned-posts entry without changing existing destinations", () => {
  const source = fs.readFileSync(new URL("../src/app/team/page.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/href="\/team\/assigned"/g) ?? []).length, 1);
  assert.ok(source.includes('href="/team/posts"'));
  assert.ok(source.includes('href="/team/posts/new"'));
});

test("unavailable team assignment pages and actions stop before any new-column query", async () => {
  const action = actionFixture({ ready: false });
  const result = await action.api.saveAssignedPartnerDraft(1, 4, {}, new FormData());
  assert.match(result.error, /团队分配功能尚未启用/);
  assert.deepEqual(action.calls, ["auth"]);
  const list = listFixture({ ready: false });
  const listTree = await list.api.default({ searchParams: { then() { throw new Error("PARAMS_NOT_NEEDED"); } } });
  assert.match(JSON.stringify(listTree), /团队分配功能尚未启用/);
  assert.deepEqual(list.calls, ["auth"]);
  const detail = detailFixture({ ready: false });
  const detailTree = await detail.api.default({ params: { then() { throw new Error("PARAMS_NOT_NEEDED"); } } });
  assert.match(JSON.stringify(detailTree), /团队分配功能尚未启用/);
  assert.deepEqual(detail.calls, ["auth"]);
});

test("unavailable team assignment photos return a private 404 before route or data access", async () => {
  const f = routeFixture({ ready: false });
  const response = await f.api.GET(new Request("https://synthetic.example/team/assigned/1/photos/x"), {
    params: { then() { throw new Error("PARAMS_NOT_NEEDED"); } },
  });
  assert.equal(response.status, 404);
  assertPrivateHeaders(response);
  assert.deepEqual(f.calls, ["auth"]);
});
