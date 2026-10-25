import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture({ authorized = true, failure } = {}) {
  const calls = [];
  class PartnerSourceError extends Error {}
  const exports = {};
  const source = fs.readFileSync(new URL("../src/app/adminzhangzhang/partner-import/actions.ts", import.meta.url), "utf8");
  const mocks = {
    "next/cache": { revalidatePath: path => calls.push(["refresh", path]) },
    "@/lib/auth": { requireAdmin: async () => {
      calls.push("auth");
      if (!authorized) throw new Error("UNAUTHORIZED");
    } },
    "@/lib/partner-image-sources": {
      PartnerSourceError,
      savePartnerImageSource: async form => {
        calls.push(["save", form]);
        if (failure === "known") throw new PartnerSourceError("来源配置无效。");
        if (failure) throw new Error("SYNTHETIC_PRIVATE_DATA");
      },
    },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require(name) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; },
  });
  return { api: exports, calls };
}

test("the source action module exposes only source saving, with no disabled workflow actions", () => {
  assert.deepEqual(Object.keys(fixture().api), ["savePartnerSource"]);
});

test("source saving authenticates before inspecting state, form or source configuration", async () => {
  const f = fixture({ authorized: false });
  const unreadable = new Proxy({}, { get() { throw new Error("PRIVATE"); } });
  await assert.rejects(f.api.savePartnerSource(unreadable, unreadable), /UNAUTHORIZED/);
  assert.deepEqual(f.calls, ["auth"]);
});

test("successful source saves refresh the image workspace only after authentication and saving", async () => {
  const f = fixture();
  const form = new FormData();
  const result = await f.api.savePartnerSource({}, form);
  assert.equal(result.message, "来源配置已保存。");
  assert.deepEqual(f.calls, ["auth", ["save", form], ["refresh", "/adminzhangzhang/partner-import"]]);
});

test("source validation errors are readable while unexpected failures never expose raw data or refresh", async () => {
  for (const failure of ["known", "unknown"]) {
    const f = fixture({ failure });
    const form = new FormData();
    const result = await f.api.savePartnerSource({}, form);
    assert.equal(result.error, failure === "known" ? "来源配置无效。" : "来源配置未保存，请检查后重试。");
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE_DATA"), false);
    assert.deepEqual(f.calls, ["auth", ["save", form]]);
  }
});
