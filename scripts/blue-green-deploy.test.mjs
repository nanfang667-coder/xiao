import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(new URL("./blue-green-deploy.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const bash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe")
  : "bash";
const shellPath = value => value.replaceAll("\\", "/");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function shellFunction(name) {
  const start = source.indexOf(`\n${name}() {\n`);
  assert.notEqual(start, -1, "Missing shell function " + name);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1);
  return source.slice(start + 1, end + 2);
}

function shell(script) {
  return spawnSync(bash, ["--noprofile", "--norc", "-c", script], {
    encoding: "utf8", windowsHide: true,
  });
}

function temporaryRepository(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "hulim-deploy-fingerprint-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
    assert.match(path.basename(directory), /^hulim-deploy-fingerprint-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Deployment fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  const write = (filename, text) => {
    const destination = path.join(directory, filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  };
  const commit = () => {
    git("add", "--all");
    git("commit", "--quiet", "-m", "synthetic deployment fixture");
    return git("rev-parse", "HEAD");
  };
  const fingerprint = revision => shell(`set -eu\nSOURCE_DIR=${quote(shellPath(directory))}\n${shellFunction("migration_fingerprint")}\nmigration_fingerprint ${quote(revision)}\n`);
  return { directory, git, write, commit, fingerprint };
}

test("migration fingerprints follow active and target commits even when the source checkout is updated", t => {
  const repo = temporaryRepository(t);
  repo.write("prisma/migrations/001_fixture/migration.sql", "-- synthetic first migration\n");
  const active = repo.commit();
  repo.write("prisma/migrations/002_fixture/migration.sql", "-- synthetic second migration\n");
  const target = repo.commit();
  assert.equal(repo.git("rev-parse", "HEAD"), target);
  const oldTree = repo.fingerprint(active);
  const newTree = repo.fingerprint(target);
  assert.equal(oldTree.status, 0, oldTree.stderr);
  assert.equal(newTree.status, 0, newTree.stderr);
  assert.notEqual(oldTree.stdout.trim(), newTree.stdout.trim());
  assert.equal(oldTree.stdout.trim(), repo.git("rev-parse", `${active}:prisma/migrations`));
  repo.write("prisma/migrations/002_fixture/migration.sql", "-- uncommitted content must not change either baseline\n");
  assert.equal(repo.fingerprint(active).stdout, oldTree.stdout);
  assert.equal(repo.fingerprint(target).stdout, newTree.stdout);
});

test("source-only commits keep the same migration fingerprint", t => {
  const repo = temporaryRepository(t);
  repo.write("prisma/migrations/001_fixture/migration.sql", "-- synthetic migration\n");
  const active = repo.commit();
  repo.write("source.txt", "application-only fixture\n");
  const target = repo.commit();
  assert.equal(repo.fingerprint(active).stdout, repo.fingerprint(target).stdout);
});

test("a verified commit without migrations is distinct from an unknown or mutable baseline", t => {
  const repo = temporaryRepository(t);
  repo.write("source.txt", "synthetic fixture\n");
  const active = repo.commit();
  const empty = repo.fingerprint(active);
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout.trim(), "none");
  for (const revision of ["", "unknown", "HEAD", "0".repeat(40), active.slice(0, 8)]) {
    const result = repo.fingerprint(revision);
    assert.notEqual(result.status, 0, "Must reject baseline: " + revision);
    assert.equal(result.stdout, "");
  }
});

test("deployment failures warn about database changes only after migration execution starts", () => {
  for (const started of [0, 1]) {
    const result = shell(`${shellFunction("log")}\n${shellFunction("cleanup")}\nDEPLOYMENT_SUCCEEDED=0\nDATABASE_MIGRATIONS_STARTED=${started}\nNGINX_SWITCHED=0\nUPSTREAM_BACKUP=''\nNEW_PROCESS=''\n(exit 42)\ncleanup\n`);
    assert.equal(result.status, 42, result.stderr);
    if (started) {
      assert.match(result.stdout, /application rollback does not undo migrations/);
      assert.match(result.stdout, /No database restore was performed automatically/);
    } else {
      assert.doesNotMatch(result.stdout, /Database migrations were started/);
    }
  }
});
