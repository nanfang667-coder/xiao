import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, mocks, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports, ...globals,
    require(name) { assert.ok(name in mocks, "Unexpected dependency: " + name); return mocks[name]; },
  });
  return exports;
}
const redirect = url => { throw new Error("REDIRECT:" + url); };
function setup({ valid = true, ip = "192.0.2.1" } = {}) {
  let now = 1_000_000;
  const limiter = load("src/lib/rate-limit.ts", {}, { Date: { now: () => now } });
  const credentials = [];
  const api = load("src/app/team/actions.ts", {
    "next/navigation": { redirect }, "next/cache": {},
    "@/lib/team-auth": { loginTeamAccount: async (username, password) => { credentials.push({ username, password }); return valid; } },
    "@/lib/rate-limit": limiter, "@/lib/request-ip": { getClientIp: async () => ip },
    "@/lib/prisma": {}, "@/lib/photo": {}, "@/lib/image-upload": {}, "@/lib/uploaded-photos": {},
    "@/lib/teacher-post-input": {}, "@/lib/team-post-quota": {},
  });
  return {
    credentials,
    advance: ms => { now += ms; },
    login: (username = "synthetic_member", password = "Synthetic secret!") => {
      const form = new FormData();
      form.set("username", username);
      form.set("password", password);
      return api.teamLogin(form);
    },
  };
}

test("successful login normalizes the username exactly as account creation and preserves the password", async () => {
  const api = setup();
  await assert.rejects(api.login("  SYNTHETIC_Member  ", "  Synthetic Secret!  "), /REDIRECT:\/team$/);
  assert.deepEqual(api.credentials, [{ username: "synthetic_member", password: "  Synthetic Secret!  " }]);
});

test("the eleventh attempt receives a rate-limit response without password validation and works after expiry", async () => {
  const api = setup();
  for (let n = 0; n < 10; n++) await assert.rejects(api.login(), /REDIRECT:\/team$/);
  await assert.rejects(api.login(), /REDIRECT:\/team\/login\?error=rate-limit$/);
  assert.equal(api.credentials.length, 10);
  api.advance(15 * 60 * 1000);
  await assert.rejects(api.login(), /REDIRECT:\/team$/);
  assert.equal(api.credentials.length, 11);
});

test("invalid credentials and account restrictions retain a generic failure without returning account information", async () => {
  const api = setup({ valid: false });
  await assert.rejects(api.login(), /^Error: REDIRECT:\/team\/login\?error=1$/);
  assert.equal(api.credentials.length, 1);
});

test("empty fields never reach authentication or consume the login rate limit", async () => {
  const api = setup();
  for (let n = 0; n < 12; n++) await assert.rejects(api.login("", ""), /error=1$/);
  assert.equal(api.credentials.length, 0);
  await assert.rejects(api.login(), /REDIRECT:\/team$/);
});

test("unknown client IP retains existing local-login behavior", async () => {
  const api = setup({ ip: "unknown" });
  for (let n = 0; n < 12; n++) await assert.rejects(api.login(), /REDIRECT:\/team$/);
  assert.equal(api.credentials.length, 12);
});

test("login UI distinguishes rate limits and uses fixed text for every other error", async () => {
  const { default: page } = load("src/app/team/login/page.tsx", {
    "react/jsx-runtime": jsx, "next/navigation": { redirect },
    "@/lib/team-auth": { getTeamAccount: async () => null }, "../actions": { teamLogin: "/synthetic-action" },
  });
  const limited = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ error: "rate-limit" }) }));
  assert.match(limited, /登录尝试过于频繁/);
  assert.match(limited, /15 分钟/);
  assert.doesNotMatch(limited, /账号或密码错误/);
  for (const error of ["1", "<untrusted-error>"]) {
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ error }) }));
    assert.match(html, /核对账号、密码和登录网址/);
    assert.doesNotMatch(html, /untrusted-error/);
  }
  const initial = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
  assert.doesNotMatch(initial, /登录失败|登录尝试过于频繁/);
});

test("already authenticated visitors go straight to the team dashboard", async () => {
  const { default: page } = load("src/app/team/login/page.tsx", {
    "react/jsx-runtime": jsx, "next/navigation": { redirect },
    "@/lib/team-auth": { getTeamAccount: async () => ({ id: 1 }) }, "../actions": {},
  });
  await assert.rejects(page({ searchParams: Promise.resolve({ error: "1" }) }), /REDIRECT:\/team$/);
});
