import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { createElement } from "react";

// Only source code and synthetic fixtures are read. No browser, environment,
// database, uploads or partner network requests are used by these tests.
function loadSource(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URLSearchParams, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
    return mocks[name];
  } });
  return exports;
}

function nodes(element) {
  if (element === null || element === undefined || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}

function words(element) {
  if (element === null || element === undefined || typeof element === "boolean") return "";
  if (typeof element !== "object") return String(element);
  return Array.isArray(element) ? element.map(words).join("") : words(element.props?.children);
}

async function pageFixture({ authorized = true, sourceRows = [{
  id: 1, name: "Synthetic source", origin: "https://partner.example",
  rules: '{"postLinkSelector":".synthetic-post"}', imageOrigins: '["https://images.example"]',
}] } = {}) {
  const calls = [];
  const partnerImagesWorkspace = () => null;
  const sources = { findMany: async args => { calls.push(["sources", args]); return sourceRows; } };
  const prisma = new Proxy({ partnerImportSource: sources }, {
    get(target, name) {
      assert.equal(name, "partnerImportSource", "Image collection must not access jobs, drafts, team accounts or business records");
      return target[name];
    },
  });
  const defaultRules = { postLinkSelector: ".synthetic-card" };
  const { default: Page } = loadSource("src/app/adminzhangzhang/partner-import/page.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: props => createElement("a", props) },
    "@/lib/auth": { requireAdmin: async () => { calls.push("requireAdmin"); if (!authorized) throw new Error("UNAUTHORIZED"); } },
    "@/lib/prisma": { prisma },
    "@/lib/partner-import-parser": { DEFAULT_PARTNER_IMPORT_RULES: defaultRules },
    "./PartnerImagesWorkspace": { PartnerImagesWorkspace: partnerImagesWorkspace },
  });
  const render = () => Page({ get searchParams() { throw new Error("Retired workflow filters must not be read"); } });
  if (!authorized) {
    await assert.rejects(render, /UNAUTHORIZED/);
    return { calls };
  }
  const element = await render();
  return {
    calls, element, sourceRows, defaultRules,
    workspace: nodes(element).find(node => node.type === partnerImagesWorkspace),
  };
}

test("image collection authenticates before reading any source or retired workflow filter", async () => {
  const unauthorized = await pageFixture({ authorized: false });
  assert.deepEqual(unauthorized.calls, ["requireAdmin"]);
  const authorized = await pageFixture();
  assert.equal(authorized.calls[0], "requireAdmin");
});

test("image collection reads only saved source configuration without jobs, drafts or team accounts", async () => {
  const { calls } = await pageFixture();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ["requireAdmin", ["sources", {
    orderBy: { name: "asc" }, select: { id: true, name: true, origin: true, rules: true, imageOrigins: true },
  }]]);
});

test("image workspace receives complete source configuration and default rules without retired workflow links", async () => {
  const { workspace, sourceRows, defaultRules, element } = await pageFixture();
  assert.ok(workspace);
  assert.equal(workspace.props.sources, sourceRows);
  assert.deepEqual(JSON.parse(JSON.stringify(workspace.props.sources)), [{
    id: 1, name: "Synthetic source", origin: "https://partner.example",
    rules: '{"postLinkSelector":".synthetic-post"}', imageOrigins: '["https://images.example"]',
  }]);
  assert.deepEqual(JSON.parse(workspace.props.defaultRules), defaultRules);
  assert.match(words(element), /合作网站图片/);
  assert.equal(nodes(element).some(node => /(?:drafts|jobs|team\/assigned|transfer)/.test(node.props?.href ?? "")), false);
});

test("empty source configuration still renders the image workspace with default rules for adding a source", async () => {
  const { workspace, defaultRules, element } = await pageFixture({ sourceRows: [] });
  assert.ok(workspace);
  assert.deepEqual(Array.from(workspace.props.sources), []);
  assert.deepEqual(JSON.parse(workspace.props.defaultRules), defaultRules);
  assert.match(words(element), /合作网站图片/);
});
