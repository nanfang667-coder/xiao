import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

// Render synthetic cards with explicit dependency mocks; no database or network access.
function load(file, mocks = {}) {
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

const mocks = {
  "react/jsx-runtime": jsx,
  "next/link": { default: "a" },
  "@/lib/photo": load("src/lib/photo.ts"),
  "@/lib/location-label": load("src/lib/location-label.ts"),
  "@/components/CompensationBadge": load("src/components/CompensationBadge.tsx", {
    "react/jsx-runtime": jsx,
  }),
};
const { TeacherCard } = load("src/components/TeacherCard.tsx", mocks);
const { NationalPromotionCard } = load("src/components/NationalPromotionCard.tsx", mocks);

function teacher(overrides = {}) {
  return {
    id: "synthetic-post", name: "示例标题", type: "钢琴", city: "示例市", district: "示例区",
    price: "500", services: "示例介绍", age: "30岁–40岁", address: "示例地址",
    photos: ["from-indigo-400 to-purple-500"], emoji: "🎹",
    createdAt: new Date("2026-10-05T00:00:00Z"), supportsCompensation: false,
    ...overrides,
  };
}

for (const [name, Card] of Object.entries({ TeacherCard, NationalPromotionCard })) {
  const render = (record) => renderToStaticMarkup(jsx.jsx(Card, { teacher: record }));

  test(`${name}: an enabled post shows one readable badge and a decorative shield`, () => {
    const html = render(teacher({ supportsCompensation: true }));
    assert.equal(html.match(/已交定金，支持赔付/g)?.length, 1);
    assert.match(html, /<svg aria-hidden="true" focusable="false"/);
    assert.match(html, /href="\/listing\/synthetic-post"/);
    assert.match(html, /示例标题/);
    assert.match(html, /500/);
  });

  test(`${name}: disabled and legacy posts do not expose a badge or placeholder`, () => {
    for (const value of [false, undefined]) {
      const html = render(teacher({ supportsCompensation: value }));
      assert.doesNotMatch(html, /已交定金|支持赔付|<svg/);
      assert.match(html, /示例标题/);
    }
  });

  test(`${name}: each post controls its own badge without leaking state to other posts`, () => {
    const enabled = teacher({ supportsCompensation: true });
    const disabled = teacher();
    assert.match(render(enabled), /已交定金，支持赔付/);
    assert.doesNotMatch(render(disabled), /已交定金，支持赔付/);
    assert.match(render(enabled), /已交定金，支持赔付/);
  });

  test(`${name}: untrusted long titles stay escaped without hiding the badge text`, () => {
    const html = render(teacher({
      name: '<img src=x onerror="alert(1)">' + "长标题".repeat(30), supportsCompensation: true,
    }));
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.equal(html.match(/已交定金，支持赔付/g)?.length, 1);
  });
}
