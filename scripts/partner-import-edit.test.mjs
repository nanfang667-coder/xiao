import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const clone = (value) => JSON.parse(JSON.stringify(value));
const oldPhotos = JSON.stringify(["/uploads/synthetic-old.jpg"]);

// Only the action source is read. All database state, uploaded files and disk
// deletion are in-memory fakes; these tests never access .env or a live database.
function fixture({ imported = true, authorized = true, failAt = "", uploads = [] } = {}) {
  const calls = [];
  const initial = {
    teachers: [{ id: 42, name: "虚构旧标题", photos: oldPhotos }],
    imports: [
      ...(imported ? [{ id: 5, teacherId: 42, revision: 3 }] : []),
      { id: 6, teacherId: 88, revision: 7 },
    ],
  };
  let state = clone(initial);
  const mocks = {
    "fs/promises": { unlink: async (filename) => calls.push(["unlink", filename]) },
    path,
    "next/headers": {},
    "next/navigation": { redirect: (location) => {
      calls.push(["redirect", location]);
      throw new Error("REDIRECT:" + location);
    } },
    "next/cache": { revalidatePath: (...args) => calls.push(["revalidate", ...args]) },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("authorize");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/prisma": { prisma: { $transaction: async (callback) => {
      calls.push("begin");
      const working = clone(state);
      const tx = {
        partnerImportedPost: { updateMany: async (args) => {
          calls.push(["partnerImportedPost.updateMany", clone(args)]);
          const matches = working.imports.filter((item) => item.teacherId === args.where.teacherId);
          for (const item of matches) {
            item.revision += args.data.revision.increment;
            if (Object.hasOwn(args.data, "teacherId")) item.teacherId = args.data.teacherId;
          }
          if (failAt === "revision") throw new Error("SYNTHETIC_REVISION_FAILURE");
          return { count: matches.length };
        } },
        teacher: {
          findUnique: async ({ where }) => {
            calls.push(["teacher.findUnique", clone(where)]);
            return working.teachers.find((item) => item.id === where.id) ?? null;
          },
          update: async ({ where, data }) => {
            calls.push(["teacher.update", clone({ where, data })]);
            const item = working.teachers.find((row) => row.id === where.id);
            if (!item) throw new Error("NOT_FOUND");
            Object.assign(item, clone(data));
            if (failAt === "update") throw new Error("SYNTHETIC_UPDATE_FAILURE");
            return item;
          },
          delete: async ({ where }) => {
            calls.push(["teacher.delete", clone(where)]);
            const index = working.teachers.findIndex((row) => row.id === where.id);
            if (index < 0) throw new Error("NOT_FOUND");
            const [item] = working.teachers.splice(index, 1);
            if (failAt === "delete") throw new Error("SYNTHETIC_DELETE_FAILURE");
            return item;
          },
        },
      };
      try {
        const result = await callback(tx);
        state = working;
        calls.push("commit");
        return result;
      } catch (error) {
        calls.push("rollback");
        throw error;
      }
    } } },
    "@/lib/admin-teacher-return": { adminTeacherReturnTo: () => "/adminzhangzhang/teachers" },
    "@/lib/photo": { emojiFor: () => "🎹", defaultGradients: () => ["synthetic-gradient"] },
    "@/lib/image-upload": {
      getSelectedPhotoFiles: () => { calls.push("selectPhotos"); return []; },
      saveUploadedPhotos: async () => { calls.push("savePhotos"); return [...uploads]; },
    },
    "@/lib/admin-session": {}, "@/lib/admin-login-limit": {},
    "@/lib/admin-login-limit-token": {}, "@/lib/request-ip": {}, "@/lib/admin-session-token": {},
  };
  const source = fs.readFileSync(new URL("../src/app/adminzhangzhang/actions.ts", import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, {
    exports,
    process: { cwd: () => path.resolve("synthetic-workspace") },
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unmocked dependency: " + name);
      return mocks[name];
    },
  });
  return { api: exports, calls, initial, state: () => clone(state) };
}

function form() {
  const data = new FormData();
  data.set("name", "虚构人工编辑");
  data.set("services", "离线测试正文");
  return data;
}

async function update(api) {
  await assert.rejects(api.updateTeacher(42, "", form()), /^Error: REDIRECT:\/adminzhangzhang\/teachers$/);
}

function assertNoCommittedEffects(calls) {
  assert.equal(calls.at(-1), "rollback");
  assert.ok(!calls.includes("commit"));
  assert.ok(!calls.some((entry) => Array.isArray(entry) && ["revalidate", "redirect", "unlink"].includes(entry[0])));
}

test("ordinary update and deletion authenticate before uploads, transactions or disk access", async () => {
  for (const operation of ["updateTeacher", "deleteTeacher"]) {
    const { api, calls, initial, state } = fixture({ authorized: false });
    await assert.rejects(operation === "updateTeacher" ? api[operation](42, "", form()) : api[operation](42), /UNAUTHORIZED/);
    assert.deepEqual(calls, ["authorize"]);
    assert.deepEqual(state(), initial);
  }
});

test("updating an imported post increments its revision atomically and preserves current photos", async () => {
  const { api, calls, state } = fixture();
  await update(api);
  const current = state();
  assert.equal(current.teachers[0].name, "虚构人工编辑");
  assert.equal(current.teachers[0].photos, oldPhotos);
  assert.deepEqual(current.imports, [{ id: 5, teacherId: 42, revision: 4 }, { id: 6, teacherId: 88, revision: 7 }]);
  const txCalls = calls.slice(calls.indexOf("begin"), calls.indexOf("commit") + 1);
  assert.deepEqual(txCalls.map((call) => Array.isArray(call) ? call[0] : call), [
    "begin", "partnerImportedPost.updateMany", "teacher.findUnique", "teacher.update", "commit",
  ]);
  assert.deepEqual(txCalls[1][1], { where: { teacherId: 42 }, data: { revision: { increment: 1 } } });
  assert.ok(calls.findIndex((call) => Array.isArray(call) && call[0] === "revalidate") > calls.indexOf("commit"));
});

test("ordinary posts retain existing edit behavior and cannot change unrelated imported revisions", async () => {
  const { api, state } = fixture({ imported: false });
  await update(api);
  assert.equal(state().teachers[0].name, "虚构人工编辑");
  assert.equal(state().teachers[0].photos, oldPhotos);
  assert.deepEqual(state().imports, [{ id: 6, teacherId: 88, revision: 7 }]);
});

test("replacement uploads are used while the imported version change stays in the transaction", async () => {
  const { api, state, calls } = fixture({ uploads: ["/uploads/synthetic-new.jpg"] });
  await update(api);
  assert.equal(state().teachers[0].photos, JSON.stringify(["/uploads/synthetic-new.jpg"]));
  assert.equal(state().imports[0].revision, 4);
  assert.ok(!calls.some((call) => Array.isArray(call) && call[0] === "teacher.findUnique"));
});

test("failed teacher edits or revision changes roll back both records and do not refresh", async () => {
  for (const failAt of ["revision", "update"]) {
    const { api, initial, state, calls } = fixture({ failAt });
    await assert.rejects(api.updateTeacher(42, "", form()), /SYNTHETIC_.*_FAILURE/);
    assert.deepEqual(state(), initial);
    assertNoCommittedEffects(calls);
  }
});

test("deleting an imported post increments revision and clears its teacher reference before commit", async () => {
  const { api, state, calls } = fixture();
  await api.deleteTeacher(42);
  assert.deepEqual(state().teachers, []);
  assert.deepEqual(state().imports, [{ id: 5, teacherId: null, revision: 4 }, { id: 6, teacherId: 88, revision: 7 }]);
  const txCalls = calls.slice(calls.indexOf("begin"), calls.indexOf("commit") + 1);
  assert.deepEqual(txCalls.map((call) => Array.isArray(call) ? call[0] : call), [
    "begin", "partnerImportedPost.updateMany", "teacher.findUnique", "teacher.delete", "commit",
  ]);
  assert.deepEqual(txCalls[1][1], { where: { teacherId: 42 }, data: { revision: { increment: 1 }, teacherId: null } });
  const diskCall = calls.findIndex((call) => Array.isArray(call) && call[0] === "unlink");
  assert.ok(diskCall > calls.indexOf("commit"));
  assert.deepEqual(calls[diskCall], ["unlink", path.join(path.resolve("synthetic-workspace"), "public", "uploads", "synthetic-old.jpg")]);
});

test("deleting an ordinary post still removes its files and leaves unrelated imported references unchanged", async () => {
  const { api, state, calls } = fixture({ imported: false });
  await api.deleteTeacher(42);
  assert.deepEqual(state().teachers, []);
  assert.deepEqual(state().imports, [{ id: 6, teacherId: 88, revision: 7 }]);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "unlink"));
});

test("failed deletion or revision changes preserve the teacher, source linkage and image files", async () => {
  for (const failAt of ["revision", "delete"]) {
    const { api, initial, state, calls } = fixture({ failAt });
    await assert.rejects(api.deleteTeacher(42), /SYNTHETIC_.*_FAILURE/);
    assert.deepEqual(state(), initial);
    assertNoCommittedEffects(calls);
  }
});
