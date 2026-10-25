import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Inspect source code only: this regression check never starts the application,
// connects to the database, reads environment files, or opens stored media.
const root = fileURLToPath(new URL("../", import.meta.url));
const retiredFiles = [
  "src/app/team/assigned/page.tsx",
  "src/app/team/assigned/actions.ts",
  "src/app/team/assigned/[id]/page.tsx",
  "src/app/team/assigned/[id]/photos/[filename]/route.ts",
  "src/app/adminzhangzhang/partner-import/DraftForm.tsx",
  "src/app/adminzhangzhang/partner-import/DraftList.tsx",
  "src/app/adminzhangzhang/partner-import/JobList.tsx",
  "src/app/adminzhangzhang/partner-import/JobRunner.tsx",
  "src/app/adminzhangzhang/partner-import/TransferUpload.tsx",
  "src/app/adminzhangzhang/partner-import/FinalReviewPanel.tsx",
  "src/app/adminzhangzhang/partner-import/assignment-actions.ts",
  "src/app/adminzhangzhang/partner-import/final-review-actions.ts",
  "src/app/adminzhangzhang/partner-import/drafts/[id]/page.tsx",
  "src/app/adminzhangzhang/partner-import/jobs/[id]/page.tsx",
  "src/app/adminzhangzhang/partner-import/transfer/route.ts",
  "src/app/adminzhangzhang/partner-import/photos/[draftId]/[filename]/route.ts",
  "src/app/adminzhangzhang/submissions/InlineImportReview.tsx",
  ...[
    "partner-import", "partner-import-assignment", "partner-import-assignment-readiness",
    "partner-import-delete", "partner-import-job-delete", "partner-import-origins",
    "partner-import-photos", "partner-import-photo-cover", "partner-import-photo-cover-render",
    "partner-import-transfer", "partner-import-transfer-format", "partner-import-transfer-client",
    "partner-import-labeled-fields", "partner-import-declarations",
  ].map(name => `src/lib/${name}.ts`),
  "scripts/apply-partner-assignment-schema.mjs",
];

const retiredModules = new Set([
  "DraftForm", "DraftList", "JobList", "JobRunner", "TransferUpload",
  "FinalReviewPanel", "InlineImportReview", "assignment-actions", "final-review-actions",
  ...retiredFiles.filter(filename => filename.startsWith("src/lib/"))
    .map(filename => path.basename(filename, ".ts")),
]);
const retiredRoutes = /^\/(?:team\/assigned|adminzhangzhang\/partner-import\/(?:drafts|jobs|transfer|photos))(?:[/?#]|$)/;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [filename] : [];
  });
}

test("assigned drafts, jobs, final review and transfer routes and UI are physically removed", () => {
  for (const filename of retiredFiles) {
    assert.equal(fs.existsSync(path.join(root, filename)), false, filename);
  }
});

test("image collection and ordinary team posting source files remain available", () => {
  for (const filename of [
    "src/app/adminzhangzhang/partner-import/page.tsx",
    "src/app/adminzhangzhang/partner-import/ImageCollector.tsx",
    "src/app/adminzhangzhang/partner-import/PartnerImagesWorkspace.tsx",
    "src/app/adminzhangzhang/partner-import/image-actions.ts",
    "src/app/adminzhangzhang/partner-import/ImportForms.tsx",
    "src/app/team/page.tsx",
    "src/app/team/posts/page.tsx",
    "src/app/team/posts/new/page.tsx",
    "src/app/adminzhangzhang/submissions/page.tsx",
    "src/app/adminzhangzhang/submissions/actions.ts",
  ]) {
    assert.equal(fs.existsSync(path.join(root, filename)), true, filename);
  }
});

test("active source has no dependencies or links to removed workflow modules and routes", () => {
  const references = [];
  for (const filename of sourceFiles(path.join(root, "src"))) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const report = (node, kind) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push(`${path.relative(root, filename)}:${line + 1}: ${kind}`);
    };
    const inspectModule = node => {
      if (!node || !ts.isStringLiteralLike(node)) return;
      const basename = node.text.split("/").at(-1).replace(/\.[cm]?[jt]sx?$/, "");
      if (retiredModules.has(basename)) report(node, "removed workflow dependency");
    };
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) inspectModule(node.moduleSpecifier);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        inspectModule(node.arguments[0]);
      }
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && retiredRoutes.test(node.text)) {
        report(node, "removed workflow route");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(references, []);
});
