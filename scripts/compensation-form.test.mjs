import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

// Only source files and synthetic fixtures are used. Every runtime dependency is explicit.
function load(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const exports = {};
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(output, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unmocked dependency: " + name);
    return mocks[name];
  } });
  return exports;
}

const noop = () => {};
const action = () => assert.fail("Rendering must not submit the form");
const { TeacherForm } = load("src/app/adminzhangzhang/TeacherForm.tsx", {
  "react/jsx-runtime": jsx,
  react: {
    useEffect: noop,
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, noop],
  },
  "react-dom": { useFormStatus: () => ({ pending: false }) },
  "next/link": { default: "a" },
  "@/data/locations": {
    provinces: [], citiesOfProvince: () => [], normalizeProvince: () => null, resolveDistrict: () => null,
  },
  "@/lib/photo": { isImage: () => false },
  "@/lib/post-photo-selection": { withSelectedPostPhotos: action },
  "./TeacherForm.module.css": { default: new Proxy({}, { get: (_, name) => name }) },
});

function teacher(supportsCompensation) {
  return {
    id: "123", name: "测试帖子", city: "", district: "", price: "500", age: "30",
    services: "测试介绍", contact: {}, photos: [], supportsCompensation,
  };
}

function renderForm(props = {}) {
  return renderToStaticMarkup(jsx.jsx(TeacherForm, { action, submitLabel: "保存", ...props }));
}

function assertSwitch(html, checked) {
  const inputs = html.match(/<input\b[^>]*\bname="supportsCompensation"[^>]*>/g) ?? [];
  assert.equal(inputs.length, 1, "Exactly one compensation field must be rendered");
  assert.match(inputs[0], /type="checkbox"/);
  assert.match(inputs[0], /role="switch"/);
  assert.equal(/\schecked(?:=|\s|>)/.test(inputs[0]), checked);
  assert.match(html, /<label[^>]*for="post-supports-compensation"/);
  assert.match(inputs[0], /aria-describedby="post-compensation-description"/);
  assert.match(html, /id="post-compensation-description"/);
  assert.match(html, /显示已交定金，支持赔付标识/);
  assert.match(html, /开启后，该帖子的前台卡片显示「已交定金，支持赔付」；关闭后隐藏。/);
}

function assertNoSwitch(html) {
  assert.doesNotMatch(html, /supportsCompensation|post-supports-compensation|显示已交定金，支持赔付标识/);
}

test("shared form hides compensation controls unless an administrator page opts in", () => {
  assertNoSwitch(renderForm());
  assertNoSwitch(renderForm({ initial: teacher(true) }));
  assertNoSwitch(renderForm({ showCompensation: false, initial: teacher(true) }));
});

test("administrator compensation switch starts unchecked and is independent of promotion", () => {
  assertSwitch(renderForm({ showCompensation: true }), false);
  const html = renderForm({ showCompensation: true, showPromotion: false });
  assertSwitch(html, false);
  assert.doesNotMatch(html, /name="isNationallyPromoted"/);
});

test("editing restores enabled, disabled, and legacy compensation values", () => {
  for (const enabled of [true, false, undefined]) {
    assertSwitch(renderForm({ showCompensation: true, initial: teacher(enabled) }), enabled === true);
  }
});

test("administrator new page authenticates and explicitly enables the switch", async () => {
  let authorized = false;
  const { default: NewTeacherPage } = load("src/app/adminzhangzhang/new/page.tsx", {
    "react/jsx-runtime": jsx,
    "@/lib/auth": { requireAdmin: async () => { authorized = true; } },
    "../actions": { createTeacher: action },
    "../TeacherForm": { TeacherForm },
  });
  const page = await NewTeacherPage();
  assert.equal(authorized, true);
  assert.equal(page.type, TeacherForm);
  assert.equal(page.props.showCompensation, true);
  assertSwitch(renderToStaticMarkup(page), false);
});

test("administrator edit page explicitly enables the switch and passes the saved value", async () => {
  for (const enabled of [true, false]) {
    let authorized = false;
    const record = teacher(enabled);
    const { default: EditTeacherPage } = load("src/app/adminzhangzhang/[id]/edit/page.tsx", {
      "react/jsx-runtime": jsx,
      "next/navigation": { notFound: () => assert.fail("Synthetic post exists") },
      "@/lib/auth": { requireAdmin: async () => { authorized = true; } },
      "@/lib/teachers": { getTeacherById: async (id) => {
        assert.equal(authorized, true);
        assert.equal(id, record.id);
        return record;
      } },
      "../../actions": { updateTeacher: action },
      "../../TeacherForm": { TeacherForm },
      "@/lib/admin-teacher-return": { adminTeacherReturnTo: () => "/adminzhangzhang/teachers" },
    });
    const page = await EditTeacherPage({
      params: Promise.resolve({ id: record.id }), searchParams: Promise.resolve({}),
    });
    assert.equal(page.type, TeacherForm);
    assert.equal(page.props.showCompensation, true);
    assert.equal(page.props.initial, record);
    assertSwitch(renderToStaticMarkup(page), enabled);
  }
});

test("actual team new-post page keeps the compensation field out of its rendered form", async () => {
  let authorized = false;
  let quotaRead = false;
  const { default: NewTeamPostPage } = load("src/app/team/posts/new/page.tsx", {
    "react/jsx-runtime": jsx,
    "next/link": { default: "a" },
    "node:crypto": { randomUUID: () => "synthetic-submission-id" },
    "@/lib/team-auth": { requireTeamAccount: async () => {
      authorized = true;
      return { id: "synthetic-team" };
    } },
    "@/app/adminzhangzhang/TeacherForm": { TeacherForm },
    "../../actions": { createTeamTeacherSubmission: action },
    "@/lib/prisma": { prisma: { teacherSubmission: { count: async ({ where }) => {
      assert.equal(authorized, true);
      assert.equal(where.teamAccountId, "synthetic-team");
      quotaRead = true;
      return 0;
    } } } },
    "@/lib/team-post-quota": {
      getEffectiveTeamPostLimit: () => 5,
      getTeamPostUsageWhere: (id) => ({ teamAccountId: id }),
      summarizeTeamPostQuota: (limit, used) => ({ limit, used, remaining: limit - used, exhausted: false }),
    },
  });
  const page = await NewTeamPostPage({ searchParams: Promise.resolve({}) });
  assert.equal(authorized, true);
  assert.equal(quotaRead, true);
  assert.equal(page.type, TeacherForm);
  assert.notEqual(page.props.showCompensation, true);
  const html = renderToStaticMarkup(page);
  assertNoSwitch(html);
  assert.match(html, /提交审核/);
});
