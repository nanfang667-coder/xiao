import * as coverApi from "../src/lib/partner-import-photo-cover.ts";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Only source files are read. All authentication, database, transport and media I/O
// use in-memory fakes; no environment files or partner content are accessed.
function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    // Use one JSON realm for the route and imported strict config validator.
    exports, Response, Uint8Array, URL, JSON, ...globals,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unmocked dependency: " + name);
      return mocks[name];
    },
  });
  return exports;
}

const privateSentinel = "SYNTHETIC_PRIVATE_BODY_AND_CONTACT";
const progress = { total: 1, queued: 0, processing: 0, imported: 1, skipped: 0, failed: 0, done: true };
const actionCases = [
  ["deletePartnerImportJob", "deleteImportJob", () => [new FormData()]],
  ["deletePartnerDrafts", "deleteImportDrafts", () => [{}, new FormData()]],
  ["detectPartnerImageOrigins", "detectImportImageOrigins", () => [{}, new FormData()]],
  ["allowPartnerImageOrigins", "addImportImageOrigins", () => [{}, new FormData()]],
  ["savePartnerSource", "saveImportSource", () => [{}, new FormData()]],
  ["startPartnerImport", "createImportJob", () => [{}, new FormData()]],
  ["runPartnerImportStep", "processImportStep", () => ["00000000-0000-4000-8000-000000000000"]],
  ["retryPartnerImport", "retryImportJob", () => ["00000000-0000-4000-8000-000000000000"]],
  ["readPartnerImportProgress", "getImportProgress", () => ["00000000-0000-4000-8000-000000000000"]],
  ["reviewPartnerDraft", "reviewImportDraft", () => [1, 1, {}, new FormData()]],
];

function actionsFixture({ authorized = true, fail = false, published = false } = {}) {
  const calls = [];
  class PartnerImportError extends Error {}
  const core = { PartnerImportError };
  for (const [, method] of actionCases) {
    core[method] = async () => {
      calls.push(method);
      if (fail) throw new Error(privateSentinel);
      if (method === "deleteImportJob") return { deletedJobId: "00000000-0000-4000-8000-000000000000", message: "任务记录已删除。" };
      if (method === "deleteImportDrafts") return { deletedDraftIds: [1, 2], message: "已删除 2 篇草稿。" };
      if (method === "createImportJob") return "00000000-0000-4000-8000-000000000000";
      if (method === "reviewImportDraft") return published ? { teacherId: 42, version: 2 } : { version: 2 };
      return progress;
    };
  }
  const api = load("src/app/adminzhangzhang/partner-import/actions.ts", {
    "next/cache": { revalidatePath: (...args) => calls.push(["revalidate", ...args]) },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("requireAdmin");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/partner-import": core,
    "@/lib/partner-import-origins": core,
    "@/lib/partner-import-delete": core,
    "@/lib/partner-import-job-delete": core,
  });
  return { api, calls };
}

test("every exported import action is covered and rejects unauthenticated requests before any effects", async () => {
  assert.deepEqual(Object.keys(actionsFixture().api).sort(), actionCases.map(([name]) => name).sort());
  for (const [name, , args] of actionCases) {
    const { api, calls } = actionsFixture({ authorized: false });
    await assert.rejects(api[name](...args()), /UNAUTHORIZED/, name);
    assert.deepEqual(calls, ["requireAdmin"], name + " must not read/write data, publish, fetch or refresh");
  }
});

test("all authorized actions authenticate before calling their corresponding operation", async () => {
  for (const [name, operation, args] of actionCases) {
    const { api, calls } = actionsFixture();
    await api[name](...args());
    assert.deepEqual(calls.slice(0, 2), ["requireAdmin", operation], name);
  }
});

test("all action error responses hide unexpected exception contents", async () => {
  for (const [name, operation, args] of actionCases) {
    const { api, calls } = actionsFixture({ fail: true });
    const result = await api[name](...args());
    assert.equal(typeof result.error, "string", name);
    assert.equal(JSON.stringify(result).includes(privateSentinel), false, name);
    assert.deepEqual(calls, ["requireAdmin", operation], name + " must not refresh after failure");
  }
});

test("only a completed publication refreshes public pages and sitemap", async () => {
  const args = actionCases.find(([name]) => name === "reviewPartnerDraft")[2];
  const saved = actionsFixture();
  await saved.api.reviewPartnerDraft(...args());
  assert.ok(saved.calls.filter(Array.isArray).every(([, pathname]) => pathname.startsWith("/adminzhangzhang/partner-import")));
  const published = actionsFixture({ published: true });
  await published.api.reviewPartnerDraft(...args());
  assert.ok(published.calls.some(call => Array.isArray(call) && call[1] === "/" && call[2] === "layout"));
  assert.ok(published.calls.some(call => Array.isArray(call) && call[1] === "/sitemap.xml"));
});

const photoKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg";
const anotherPhotoKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg";
const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function photoFixture({ authorized = true, photos = JSON.stringify([photoKey]), missing = false, failDb = false, failFile = false, fields = "{}", failRender = false, status = "published" } = {}) {
  const calls = [];
  const unexpected = () => { throw new Error("Unexpected media operation"); };
  // Load the real photo key/path validation with mocked file/network operations.
  const photoApi = load("src/lib/partner-import-photos.ts", {
    "node:crypto": {},
    "node:fs/promises": {
      mkdir: unexpected, copyFile: unexpected, unlink: unexpected,
      readFile: async filename => {
        calls.push(["readFile", filename]);
        if (failFile) throw new Error(privateSentinel);
        return jpegBytes;
      },
    },
    "node:path": path,
    "node:fs": { constants: {} },
    "./image-upload": { saveUploadedPhotos: unexpected },
    "./partner-import-fetch": { fetchPartnerResource: unexpected },
    "./partner-import-photo-cover": coverApi,
    "./partner-import-photo-cover-render": { renderPartnerPhotoCover: unexpected },
  }, { process: { cwd: () => path.resolve("synthetic-workspace") } });
  const api = load("src/app/adminzhangzhang/partner-import/photos/[draftId]/[filename]/route.ts", {
    "@/lib/auth": { isAdmin: async () => { calls.push("isAdmin"); return authorized; } },
    "@/lib/prisma": { prisma: { partnerImportDraft: { findUnique: async args => {
      calls.push(["findUnique", JSON.parse(JSON.stringify(args))]);
      if (failDb) throw new Error(privateSentinel);
      return missing ? null : { photos, fields, status };
    } } } },
    "@/lib/partner-import-photos": photoApi,
    "@/lib/partner-import-photo-cover": coverApi,
    "@/lib/partner-import-photo-cover-render": { renderPartnerPhotoCover: async (bytes, cover) => {
      calls.push(["renderCover", JSON.parse(JSON.stringify(cover))]);
      if (failRender) throw new Error(privateSentinel);
      assert.deepEqual(bytes, jpegBytes);
      return Uint8Array.from([0xff, 0xd8, 1, 0xff, 0xd9]);
    } },
  });
  const get = (draftId = "1", filename = photoKey, query = "") => api.GET(new Request("https://local.example/private" + query), {
    params: Promise.resolve({ draftId, filename }),
  });
  return { api, get, calls };
}

function assertPrivateHeaders(response) {
  assert.match(response.headers.get("cache-control"), /private/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("private photos return 401 before reading route parameters, database or files when signed out", async () => {
  const { api, calls } = photoFixture({ authorized: false });
  const response = await api.GET(new Request("https://local.example/private"), {
    params: { then() { throw new Error("Parameters must not be read before authentication"); } },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(calls, ["isAdmin"]);
  assertPrivateHeaders(response);
});

test("private photos reject path traversal and invalid draft IDs before database or disk reads", async () => {
  for (const filename of ["../" + photoKey, "..\\" + photoKey, "%2e%2e%2f" + photoKey, "/" + photoKey, "sample.svg", photoKey + "?x=1"]) {
    const { get, calls } = photoFixture();
    const response = await get("1", filename);
    assert.equal(response.status, 404, filename);
    assert.deepEqual(calls, ["isAdmin"]);
    assertPrivateHeaders(response);
  }
  for (const id of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
    const { get, calls } = photoFixture();
    assert.equal((await get(id)).status, 404);
    assert.deepEqual(calls, ["isAdmin"]);
  }
});

test("an authenticated admin cannot read a file that does not belong to the requested draft", async () => {
  for (const options of [{ photos: JSON.stringify([anotherPhotoKey]) }, { missing: true }, { photos: "[]" }, { photos: "invalid-json" }]) {
    const { get, calls } = photoFixture(options);
    const response = await get();
    assert.equal(response.status, 404);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], "isAdmin");
    assert.equal(calls[1][0], "findUnique");
    assertPrivateHeaders(response);
  }
});

test("authenticated draft-owned images return JPEG bytes with private no-store and noindex headers", async () => {
  const { get, calls, api } = photoFixture();
  const response = await get();
  assert.equal(api.dynamic, "force-dynamic");
  assert.equal(api.runtime, "nodejs");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("content-length"), String(jpegBytes.length));
  assertPrivateHeaders(response);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpegBytes);
  assert.deepEqual(calls[1], ["findUnique", { where: { id: 1 }, select: { photos: true, fields: true, status: true } }]);
  assert.deepEqual(calls[2], ["readFile", path.join(path.resolve("synthetic-workspace"), "storage", "partner-import", photoKey)]);
});

test("private photo database and disk errors never expose exception contents", async () => {
  for (const options of [{ failDb: true }, { failFile: true }]) {
    const { get } = photoFixture(options);
    const response = await get();
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes(privateSentinel), false);
    assertPrivateHeaders(response);
  }
});

test("batch deletion refreshes only the private list and deleted draft paths", async () => {
  const { api, calls } = actionsFixture();
  const result = await api.deletePartnerDrafts({}, new FormData());
  assert.deepEqual(result.deletedDraftIds, [1, 2]);
  assert.deepEqual(calls, ["requireAdmin", "deleteImportDrafts",
    ["revalidate", "/adminzhangzhang/partner-import"],
    ["revalidate", "/adminzhangzhang/partner-import/drafts/1"],
    ["revalidate", "/adminzhangzhang/partner-import/drafts/2"],
  ]);
});

const syntheticCover = { text: "site.example", position: "bottom", align: "center", widthPercent: 100, heightPercent: 15 };
const coverQuery = "?cover=" + encodeURIComponent(JSON.stringify(syntheticCover));

test("cover previews authenticate and verify image ownership before rendering", async () => {
  for (const options of [{ authorized: false }, { photos: JSON.stringify([anotherPhotoKey]) }]) {
    const f = photoFixture(options);
    const response = await f.get("1", photoKey, coverQuery);
    assert.equal(response.status, options.authorized === false ? 401 : 404);
    assert.equal(f.calls.some(call => Array.isArray(call) && ["readFile", "renderCover"].includes(call[0])), false);
    assertPrivateHeaders(response);
  }
});
test("preview uses the requested exact cover privately without persisting changes", async () => {
  const f = photoFixture();
  const response = await f.get("1", photoKey, coverQuery);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.at(-1), ["renderCover", syntheticCover]);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xd8, 1, 0xff, 0xd9]);
  assertPrivateHeaders(response);
});
test("saved cover renders by default and the off preview returns the unchanged original", async () => {
  const f = photoFixture({ fields: JSON.stringify({ _photoCover: syntheticCover }) });
  assert.equal((await f.get()).status, 200);
  assert.deepEqual(f.calls.at(-1), ["renderCover", syntheticCover]);
  const off = photoFixture({ fields: JSON.stringify({ _photoCover: syntheticCover }) });
  const response = await off.get("1", photoKey, "?cover=off");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpegBytes);
  assert.equal(off.calls.some(call => Array.isArray(call) && call[0] === "renderCover"), false);
  assertPrivateHeaders(response);
});
test("invalid or oversized preview settings are rejected before image reads", async () => {
  for (const query of ["?cover=broken", "?cover=" + "x".repeat(1025), "?cover=" + encodeURIComponent(JSON.stringify({ ...syntheticCover, text: "<svg>unsafe</svg>" }))]) {
    const f = photoFixture();
    const response = await f.get("1", photoKey, query);
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "Invalid photo cover");
    assert.equal(f.calls.length, 2);
    assertPrivateHeaders(response);
  }
});
test("render failures disclose no private data and do not return an uncovered fallback image", async () => {
  const f = photoFixture({ failRender: true });
  const response = await f.get("1", photoKey, coverQuery);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
  assertPrivateHeaders(response);
});

test("default photo requests cover pending legacy drafts but respect explicit off and historical originals", async () => {
  const pending = photoFixture({ status: "pending" });
  assert.equal((await pending.get()).status, 200);
  assert.deepEqual(pending.calls.at(-1), ["renderCover", coverApi.DEFAULT_PARTNER_PHOTO_COVER]);
  for (const options of [
    { status: "pending", fields: '{"_photoCover":null}' },
    { status: "published" }, { status: "rejected" },
  ]) {
    const f = photoFixture(options);
    const response = await f.get();
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpegBytes);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "renderCover"), false);
    assertPrivateHeaders(response);
  }
});

test("job deletion refreshes only the private task list and deleted job path", async () => {
  const { api, calls } = actionsFixture();
  const result = await api.deletePartnerImportJob(new FormData());
  assert.equal(result.deletedJobId, "00000000-0000-4000-8000-000000000000");
  assert.deepEqual(calls, ["requireAdmin", "deleteImportJob",
    ["revalidate", "/adminzhangzhang/partner-import"],
    ["revalidate", "/adminzhangzhang/partner-import/jobs/00000000-0000-4000-8000-000000000000"],
  ]);
});
