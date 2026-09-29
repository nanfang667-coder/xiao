import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// All job data and dependencies are synthetic; no database, environment, files
// containing user content, or network requests are opened by the page fixture.
const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const missingMessage = "导入任务不存在。";
class PartnerImportError extends Error {}
const progress = { total: 1, queued: 0, processing: 0, imported: 1, skipped: 0, failed: 0, done: true };
const source = fs.readFileSync(new URL("../src/app/adminzhangzhang/partner-import/jobs/[id]/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

function fixture({ authorized = true, missing = false, databaseError, progressError } = {}) {
  const calls = [];
  const absent = new Error("SYNTHETIC_NOT_FOUND");
  const denied = new Error("SYNTHETIC_UNAUTHORIZED");
  const element = (type, props, key) => ({ type, props, key });
  const job = { id: jobId, createdAt: new Date("2026-01-01T00:00:00Z"), source: { name: "虚构来源" } };
  const mocks = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "next/link": { default: "Link", __esModule: true },
    "next/navigation": { notFound() { calls.push("notFound"); throw absent; } },
    "@/lib/auth": { requireAdmin: async () => { calls.push("auth"); if (!authorized) throw denied; } },
    "@/lib/prisma": { prisma: { partnerImportJob: { findUnique: async args => {
      calls.push("findUnique");
      assert.deepEqual(JSON.parse(JSON.stringify(args)), {
        where: { id: jobId }, select: { id: true, createdAt: true, source: { select: { name: true } } },
      });
      if (databaseError) throw databaseError;
      return missing ? null : job;
    } } } },
    "@/lib/partner-import": { PartnerImportError, getImportProgress: async id => {
      calls.push("getImportProgress");
      assert.equal(id, jobId);
      if (progressError) throw progressError;
      return progress;
    } },
    "../../JobRunner": { JobRunner: "JobRunner" },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected page dependency: " + name);
    return mocks[name];
  } });
  const render = (params = Promise.resolve({ id: jobId })) => exports.default({ params });
  return { render, calls, absent, denied };
}

function findRunner(tree) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.type === "JobRunner") return tree;
  for (const value of Object.values(tree)) {
    const found = findRunner(value);
    if (found) return found;
  }
  return null;
}

test("normal job pages render only the selected metadata and progress", async () => {
  const f = fixture();
  const tree = await f.render();
  const runner = findRunner(tree);
  assert.ok(runner);
  assert.equal(runner.key, jobId);
  assert.equal(runner.props.jobId, jobId);
  assert.equal(runner.props.initialProgress, progress);
  assert.deepEqual(f.calls, ["auth", "findUnique", "getImportProgress"]);
});

test("jobs deleted before the first read return notFound without a progress query", async () => {
  const f = fixture({ missing: true });
  await assert.rejects(f.render(), error => error === f.absent);
  assert.deepEqual(f.calls, ["auth", "findUnique", "notFound"]);
});

test("jobs deleted between metadata and progress reads return notFound", async () => {
  const f = fixture({ progressError: new PartnerImportError(missingMessage) });
  await assert.rejects(f.render(), error => error === f.absent);
  assert.deepEqual(f.calls, ["auth", "findUnique", "getImportProgress", "notFound"]);
});

test("unknown database and progress errors are preserved, never misclassified as a missing job", async () => {
  const databaseError = new Error("SYNTHETIC_DATABASE_FAILURE");
  const failedDb = fixture({ databaseError });
  await assert.rejects(failedDb.render(), error => error === databaseError);
  assert.deepEqual(failedDb.calls, ["auth", "findUnique"]);
  for (const progressError of [new Error(missingMessage), new Error("SYNTHETIC_DATABASE_FAILURE"), new PartnerImportError("其他业务错误")]) {
    const f = fixture({ progressError });
    await assert.rejects(f.render(), error => error === progressError);
    assert.deepEqual(f.calls, ["auth", "findUnique", "getImportProgress"]);
  }
});

test("authentication happens before parameters or database access", async () => {
  const f = fixture({ authorized: false });
  await assert.rejects(f.render({ then() { throw new Error("Parameters read before authentication"); } }), error => error === f.denied);
  assert.deepEqual(f.calls, ["auth"]);
});

test("invalid route segments return notFound before querying data", async () => {
  for (const id of ["", "../private", "x".repeat(101)]) {
    const f = fixture();
    await assert.rejects(f.render(Promise.resolve({ id })), error => error === f.absent);
    assert.deepEqual(f.calls, ["auth", "notFound"]);
  }
});
