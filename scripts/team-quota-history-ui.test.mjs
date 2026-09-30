import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, URLSearchParams, require(name) {
    assert.ok(name in mocks, "Unmocked dependency: " + name);
    return mocks[name];
  } });
  return exports;
}

function event(overrides = {}) {
  return {
    id: 1, teamAccountId: 7, teamUsername: "synthetic-team", kind: "allowance_added",
    delta: 20, previousLimit: 150, newLimit: 170, legacyBonus: null, legacyMonth: null,
    createdAt: new Date("2026-09-30T16:10:00Z"), ...overrides,
  };
}

function matches(record, where) {
  if (where.teamAccountId && record.teamAccountId !== where.teamAccountId) return false;
  if (where.teamUsername && !record.teamUsername.includes(where.teamUsername.contains)) return false;
  if (where.kind && (typeof where.kind === "string"
    ? record.kind !== where.kind : record.kind === where.kind.not)) return false;
  if (where.createdAt && !(record.createdAt >= where.createdAt.gte && record.createdAt < where.createdAt.lt)) return false;
  if (where.legacyMonth && record.legacyMonth !== where.legacyMonth) return false;
  return !where.OR || where.OR.some(condition => matches(record, condition));
}

function fixture({ authorized = true, ready = true, records = [event()] } = {}) {
  const calls = [];
  let authenticated = false;
  const { default: Page } = load("src/app/adminzhangzhang/sites/quota-history/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: "a" },
    "@/lib/auth": { requireAdmin: async () => {
      if (!authorized) throw new Error("UNAUTHORIZED");
      authenticated = true;
    } },
    "@/lib/pagination": load("src/lib/pagination.ts"),
    "@/lib/team-quota-history-readiness": { isTeamQuotaHistoryReady: async () => {
      assert.equal(authenticated, true);
      calls.push({ method: "ready" });
      return ready;
    } },
    "@/lib/prisma": { prisma: { teamPostQuotaEvent: {
      count: async (args) => {
        assert.equal(authenticated, true);
        calls.push({ method: "count", ...args });
        return records.filter(record => matches(record, args.where)).length;
      },
      findMany: async (args) => {
        assert.equal(authenticated, true);
        calls.push({ method: "findMany", ...args });
        return records.filter(record => matches(record, args.where))
          .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
          .slice(args.skip, args.skip + args.take);
      },
    } } },
  });
  return {
    calls,
    render: async (params = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) })),
  };
}

test("quota history requires administrator authorization before readiness or data access", async () => {
  const page = fixture({ authorized: false });
  await assert.rejects(page.render(), /UNAUTHORIZED/);
  assert.deepEqual(page.calls, []);
});

test("unavailable history shows a graceful status without querying the missing ledger", async () => {
  const page = fixture({ ready: false });
  const html = await page.render();
  assert.match(html, /额度记录暂不可用/);
  assert.deepEqual(page.calls, [{ method: "ready" }]);
  assert.doesNotMatch(html, /没有符合条件的记录/);
});

test("operation history identifies the account, delta, quota totals and Beijing time", async () => {
  const page = fixture({ records: [event(), event({
    id: 2, teamAccountId: null, teamUsername: "<synthetic-deleted>", kind: "base_changed",
    delta: -128, previousLimit: 170, newLimit: 42,
  })] });
  const html = await page.render();
  assert.match(html, /synthetic-team/);
  assert.match(html, /操作记录 · 追加额度/);
  assert.match(html, /\+20 条/);
  assert.match(html, /总额度：150 → 170 条/);
  assert.match(html, /2026\/10\/01 00:10:00/);
  assert.match(html, /操作记录 · 调整基础额度/);
  assert.match(html, /-128 条/);
  assert.match(html, /账号已删除，记录仍保留/);
  assert.match(html, /&lt;synthetic-deleted&gt;/);
  assert.doesNotMatch(html, /<synthetic-deleted>/);
  const query = page.calls.find(call => call.method === "findMany");
  assert.deepEqual(JSON.parse(JSON.stringify(query.orderBy)), [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(query.take, 20);
  assert.deepEqual(Object.keys(query.select).sort(), [
    "createdAt", "delta", "id", "kind", "legacyBonus", "legacyMonth", "newLimit", "previousLimit", "teamAccountId", "teamUsername",
  ]);
});

test("September filter uses Beijing boundaries and old snapshot month markers without inventing dated operations", async () => {
  const page = fixture({ records: [
    event({ id: 1, teamUsername: "before-september", createdAt: new Date("2026-08-31T15:59:59Z") }),
    event({ id: 2, teamUsername: "september-start", createdAt: new Date("2026-08-31T16:00:00Z") }),
    event({ id: 3, teamUsername: "september-end", createdAt: new Date("2026-09-30T15:59:59Z") }),
    event({ id: 4, teamUsername: "october-start", createdAt: new Date("2026-09-30T16:00:00Z") }),
    event({ id: 5, teamUsername: "september-snapshot", kind: "legacy_snapshot", delta: null,
      previousLimit: null, newLimit: 190, legacyBonus: 40, legacyMonth: "2026-09", createdAt: new Date("2026-10-01T03:00:00Z") }),
    event({ id: 6, teamUsername: "august-snapshot", kind: "legacy_snapshot", delta: null,
      previousLimit: null, legacyBonus: 20, legacyMonth: "2026-08", createdAt: new Date("2026-09-15T03:00:00Z") }),
  ] });
  const html = await page.render({ month: "2026-09" });
  assert.match(html, /共 3 条记录/);
  for (const name of ["september-start", "september-end", "september-snapshot"]) assert.match(html, new RegExp(name));
  for (const name of ["before-september", "october-start", "august-snapshot"]) assert.doesNotMatch(html, new RegExp(name));
  assert.match(html, /旧数据快照/);
  assert.match(html, /保留的累计追加额度：<strong[^>]*>40 条/);
  assert.match(html, /快照时总额度：190 条/);
  assert.match(html, /来源月份标记：2026-09（不是该月增加条数）/);
  assert.match(html, /实际操作时间和逐次条数未知/);
  assert.match(html, /快照采集时间：<time[^>]*>2026\/10\/01 11:00:00/);
  assert.doesNotMatch(html, /\+40 条/);
  const where = page.calls.find(call => call.method === "count").where;
  assert.equal(where.OR[0].createdAt.gte.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(where.OR[0].createdAt.lt.toISOString(), "2026-09-30T16:00:00.000Z");
});

test("account and username filters combine with month and persist in pagination", async () => {
  const records = Array.from({ length: 42 }, (_, index) => event({ id: index + 1 }));
  records.push(event({ id: 43, teamAccountId: 8, teamUsername: "another-team" }));
  const page = fixture({ records });
  const html = await page.render({ account: ["7", "8"], q: " synthetic ", month: "2026-10", page: "2" });
  assert.match(html, /共 42 条记录/);
  assert.match(html, /第 2 \/ 3 页/);
  assert.match(html, /name="account" value="7"/);
  assert.match(html, /href="\/adminzhangzhang\/sites\/quota-history\?account=7&amp;q=synthetic&amp;month=2026-10&amp;page=3"/);
  assert.match(html, /href="\/adminzhangzhang\/sites\/quota-history\?q=synthetic&amp;month=2026-10"/);
  const query = page.calls.find(call => call.method === "findMany");
  assert.equal(query.where.teamAccountId, 7);
  assert.equal(query.where.teamUsername.contains, "synthetic");
  assert.equal(query.skip, 20);
  assert.doesNotMatch(html, /another-team/);
});

test("malformed filters are bounded and out-of-range pages are clamped", async () => {
  for (const account of ["-1", "0", "1.5", "1e2", "2147483648", "Infinity"]) {
    const page = fixture();
    await page.render({ account, month: "2026-13", page: "999" });
    const query = page.calls.find(call => call.method === "findMany");
    assert.equal(query.where.teamAccountId, undefined);
    assert.equal(query.where.OR, undefined);
    assert.equal(query.skip, 0);
  }
  const page = fixture();
  await page.render({ q: "a".repeat(100), month: "2026-09-01" });
  assert.equal(page.calls.find(call => call.method === "count").where.teamUsername.contains.length, 32);
});

test("December month range crosses into the next year", async () => {
  const page = fixture();
  await page.render({ month: "2026-12" });
  const range = page.calls.find(call => call.method === "count").where.OR[0].createdAt;
  assert.equal(range.gte.toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(range.lt.toISOString(), "2026-12-31T16:00:00.000Z");
});

test("an empty historic month does not imply there were no old allowance additions", async () => {
  const page = fixture({ records: [] });
  const html = await page.render({ month: "2026-09" });
  assert.match(html, /旧数据未保存逐次操作，不能据此判断当时是否追加过额度/);
  assert.match(html, /无法还原每次追加的条数、时间或已被覆盖的数据/);
  assert.doesNotMatch(html, /额度记录分页/);
});
