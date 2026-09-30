import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, mocks, now) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Date: FixedDate,
    require(name) {
      assert.ok(name in mocks, "Unexpected dependency: " + name);
      return mocks[name];
    },
  });
  return exports;
}

function fixtures({ used = 100, bonus = 0, now = "2026-10-01T00:00:00Z" } = {}) {
  const account = {
    id: 17,
    username: "synthetic-team",
    site: { name: "测试站点" },
    monthlyPostLimit: 150,
    monthlyPostLimitOverride: null,
    monthlyPostBonus: bonus,
    monthlyPostBonusMonth: "2026-09",
  };
  const records = Array.from({ length: used }, (_, index) => ({
    teamAccountId: account.id,
    kind: "create",
    status: index === 0 ? "pending" : "approved",
    createdAt: new Date(index % 2 ? "2026-08-15T00:00:00Z" : "2026-09-15T00:00:00Z"),
  }));
  records.push(
    { teamAccountId: account.id, kind: "create", status: "rejected" },
    { teamAccountId: account.id, kind: "update", status: "approved" },
    { teamAccountId: 99, kind: "create", status: "approved" },
  );
  let authenticated = false;
  const queries = [];
  const requireTeamAccount = async () => {
    authenticated = true;
    return account;
  };
  const count = async ({ where }) => {
    assert.equal(authenticated, true);
    queries.push(where);
    return records.filter((record) =>
      record.teamAccountId === where.teamAccountId
      && (!where.kind || record.kind === where.kind)
      && (typeof where.status === "string"
        ? record.status === where.status
        : where.status.in.includes(record.status))
      && (!where.createdAt
        || (record.createdAt >= where.createdAt.gte && record.createdAt < where.createdAt.lt)),
    ).length;
  };
  const quota = load("src/lib/team-post-quota.ts", {}, now);
  const common = {
    "react/jsx-runtime": jsx,
    "next/link": { default: "a" },
    "@/lib/team-auth": { requireTeamAccount },
    "@/lib/team-post-quota": quota,
    "@/lib/prisma": { prisma: {
      teacherSubmission: { count, findMany: async () => [] },
      teacherOwnership: { count: async () => 0, findMany: async () => [] },
      teacher: { aggregate: async () => ({ _sum: { viewCount: 0 } }) },
      siteVisit: { count: async () => 0 },
    } },
  };
  const dashboard = load("src/app/team/page.tsx", {
    ...common,
    "@/lib/site-visitor-stats": {
      getTodayNewVisitorCount: async () => 0,
      getLast24HourVisitorCount: async () => 0,
    },
    "./actions": { teamLogout() {} },
  }, now).default;
  const posts = load("src/app/team/posts/page.tsx", {
    ...common,
    "@/lib/photo": { isImage: () => false },
  }, now).default;
  let formProps;
  const create = load("src/app/team/posts/new/page.tsx", {
    ...common,
    "node:crypto": { randomUUID: () => "synthetic-submission-key" },
    "../../actions": { createTeamTeacherSubmission() {} },
    "@/app/adminzhangzhang/TeacherForm": { TeacherForm(props) {
      formProps = props;
      return jsx.jsx("p", { children: props.notice });
    } },
  }, now).default;
  return {
    dashboard, posts, create, queries, records,
    get formProps() { return formProps; },
  };
}

test("all team pages retain historic usage across the month boundary", async () => {
  for (const now of ["2026-09-30T15:59:59Z", "2026-09-30T16:00:00Z"]) {
    const fixture = fixtures({ now });
    const dashboard = renderToStaticMarkup(await fixture.dashboard());
    const posts = renderToStaticMarkup(await fixture.posts({ searchParams: Promise.resolve({}) }));
    renderToStaticMarkup(await fixture.create({ searchParams: Promise.resolve({}) }));
    for (const html of [dashboard, posts]) {
      assert.match(html, /已用 100\/150 条，剩余 50 条/);
      assert.match(html, /剩余额度跨月保留/);
      assert.match(html, /href="\/team\/posts\/new"/);
    }
    assert.match(fixture.formProps.notice, /剩余 50 条新帖额度，跨月保留/);
    assert.equal(fixture.queries.filter((query) => query.kind === "create").length, 3);
    assert.ok(fixture.queries.every((query) => !("createdAt" in query)));
  }
});

test("exhausted historic quota closes every team publish entry until quota is added", async () => {
  const fixture = fixtures({ used: 150 });
  const dashboard = renderToStaticMarkup(await fixture.dashboard());
  const posts = renderToStaticMarkup(await fixture.posts({ searchParams: Promise.resolve({}) }));
  const create = renderToStaticMarkup(await fixture.create({ searchParams: Promise.resolve({}) }));
  for (const html of [dashboard, posts]) {
    assert.match(html, /已用 150\/150 条，剩余 0 条/);
    assert.doesNotMatch(html, /href="\/team\/posts\/new"/);
  }
  assert.equal(fixture.formProps, undefined);
  assert.match(create, /请联系管理员追加额度/);
  assert.match(create, /额度不会在月初重置/);

  const replenished = fixtures({ used: 150, bonus: 20 });
  renderToStaticMarkup(await replenished.create({ searchParams: Promise.resolve({}) }));
  assert.match(replenished.formProps.notice, /剩余 20 条新帖额度/);
});

test("rejected historical submission releases quota and permits the create form", async () => {
  const fixture = fixtures({ used: 150 });
  fixture.records[0].status = "rejected";
  renderToStaticMarkup(await fixture.create({ searchParams: Promise.resolve({ error: "quota" }) }));
  assert.ok(fixture.formProps);
  assert.match(fixture.formProps.notice, /提交时发帖额度不足/);
  assert.match(fixture.formProps.notice, /审核拒绝会释放额度/);
});
