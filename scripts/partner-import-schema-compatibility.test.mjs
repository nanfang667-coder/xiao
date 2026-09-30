import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const migrationRoot = path.join(root, "prisma/migrations");
const finalMigration = "20260928000300_add_partner_import_assignments";

// Only a newly-created synthetic SQLite file is ever opened. Prisma receives its
// explicit path; no project .env or existing database is needed by these tests.
async function withLegacyDatabase(run) {
  const tempRoot = path.join(root, ".partner-import-check");
  fs.mkdirSync(tempRoot, { recursive: true });
  const file = path.join(tempRoot, "compatibility-" + randomUUID() + ".db");
  const db = new DatabaseSync(file);
  let prisma;
  try {
    db.exec('CREATE TABLE Site(id TEXT PRIMARY KEY); CREATE TABLE TeamAccount(id INTEGER PRIMARY KEY); CREATE TABLE Teacher(id INTEGER PRIMARY KEY); INSERT INTO TeamAccount VALUES (1);');
    db.prepare("INSERT INTO Site VALUES (?)").run("synthetic");
    for (const directory of ["20260903010000_add_team_teacher_submissions", "20260917000100_deduplicate_team_submissions", "20260928000100_add_partner_imports"]) {
      db.exec(fs.readFileSync(path.join(migrationRoot, directory, "migration.sql"), "utf8"));
    }
    prisma = new PrismaClient({ datasourceUrl: "file:" + file.replaceAll("\\", "/") });
    await run({ prisma, db });
  } finally {
    await prisma?.$disconnect();
    db.close();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const target = file + suffix;
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
  }
}

function loadModule(file, mocks) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(compiled, {
    exports, FormData, URL, URLSearchParams, Buffer, console,
    require(name) { assert.ok(name in mocks, "Unexpected dependency: " + name); return mocks[name]; },
  });
  return exports;
}

function readiness(prisma) {
  return loadModule("src/lib/partner-import-assignment-readiness.ts", {
    "server-only": {}, "./prisma": { prisma },
  });
}

test("real generated client detects absent assignment columns and observes later schema activation", async () => {
  await withLegacyDatabase(async ({ prisma, db }) => {
    const api = readiness(prisma);
    assert.equal(await api.isPartnerImportAssignmentReady(), false);
    db.exec(fs.readFileSync(path.join(migrationRoot, finalMigration, "migration.sql"), "utf8"));
    assert.equal(await api.isPartnerImportAssignmentReady(), true);
  });
});

test("new Prisma client can create and display ordinary team submissions against the old schema", async () => {
  await withLegacyDatabase(async ({ prisma }) => {
    const site = await prisma.site.findFirstOrThrow({ select: { id: true } });
    const account = { id: 1, siteId: site.id };
    const quota = {
      getEffectiveTeamPostLimit: () => 10,
      getTeamPostUsageWhere: () => ({ teamAccountId: account.id }),
      summarizeTeamPostQuota: (limit, used) => ({ limit, used, remaining: limit - used, exhausted: used >= limit }),
    };
    const actions = loadModule("src/app/team/actions.ts", {
      "next/navigation": { redirect(url) { throw new Error("REDIRECT:" + url); } },
      "next/cache": { revalidatePath() {} },
      "@/lib/team-auth": { requireTeamAccount: async () => account },
      "@/lib/rate-limit": {}, "@/lib/request-ip": {},
      "@/lib/prisma": { prisma },
      "@/lib/photo": { defaultGradients: () => [], emojiFor: () => "" },
      "@/lib/image-upload": { getSelectedPhotoFiles: () => [], saveUploadedPhotos: async () => [] },
      "@/lib/uploaded-photos": { deleteUploadedPhotos: async () => assert.fail("No uploaded files to delete") },
      "@/lib/teacher-post-input": { extractTeacherPostFields: () => ({
        name: "Synthetic ordinary submission", type: "test", city: "test", district: "test",
        price: "", services: "Synthetic service", phone: "synthetic", wechat: "",
      }) },
      "@/lib/team-post-quota": quota,
    });
    await assert.rejects(
      actions.createTeamTeacherSubmission("00000000-0000-4000-8000-000000000001", new FormData()),
      /REDIRECT:\/team\/posts\?submitted=1/,
    );
    assert.equal(await prisma.teacherSubmission.count(), 1);
    const { default: page } = loadModule("src/app/team/posts/page.tsx", {
      "react/jsx-runtime": jsx, "next/link": { default: "a" },
      "@/lib/prisma": { prisma },
      "@/lib/team-auth": { requireTeamAccount: async () => account },
      "@/lib/photo": { isImage: () => false },
      "@/lib/team-post-quota": quota,
    });
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
    assert.match(html, /Synthetic ordinary submission/);
    assert.match(html, /待审核/);
  });
});
