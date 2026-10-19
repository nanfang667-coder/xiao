import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = fs.readFileSync(new URL("./migrate-hk-cutover.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const bash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe")
  : "bash";
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const shellPath = value => value.replaceAll("\\", "/");
const run = (script, args = []) => spawnSync(bash, ["--noprofile", "--norc", "-c", script, "migration-test", ...args], {
  encoding: "utf8", windowsHide: true,
});

test("migration script parses and validates its offline upstream templates", () => {
  const syntax = spawnSync(bash, ["-n"], { input: source, encoding: "utf8", windowsHide: true });
  assert.equal(syntax.status, 0, syntax.stderr);
  const result = run(source, ["--self-test"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UPSTREAM_TEMPLATE_TESTS_OK/);
  const bridge = run(source, ["--render", "bridge", "yes"]);
  assert.equal(bridge.status, 0, bridge.stderr);
  assert.match(bridge.stdout, /proxy_ssl_verify on;/);
  assert.match(bridge.stdout, /proxy_ssl_name \$host;/);
  assert.match(bridge.stdout, /proxy_ssl_session_reuse off;/);
  assert.match(bridge.stdout, /GET\|HEAD\|OPTIONS/);
});

function launcherFixture(t, { nginxFails = false, existing = false } = {}) {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, "hulim-cutover-test-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), root);
    assert.match(path.basename(directory), /^hulim-cutover-test-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const safeSource = source
    .replace("BASE=/root/hulim-migration", `BASE=${quote(shellPath(directory))}`)
    .replace('[[ "$EUID" -eq 0 && "$(hostname)" == hulim-hk ]]', "true");
  const script = path.join(directory, "cutover.sh");
  fs.writeFileSync(script, safeSource);
  if (existing) fs.writeFileSync(path.join(directory, "NEW_PRIMARY"), "already-primary");
  const stubs = `
    systemctl() { printf 'not-found\\n'; }
    nginx() { ${nginxFails ? "return 1" : "return 0"}; }
    flock() { return 0; }
    systemd-run() { printf '%s\\n' "$@" > "$BASE/launched"; }
    cat() { case "$1" in /etc/nginx/*) printf 'test upstream\\n';; *) command cat "$@";; esac; }
    export -f systemctl nginx flock systemd-run cat
  `;
  return {
    directory,
    execute: () => run(`BASE=${quote(shellPath(directory))}; export BASE; ${stubs}\nbash ${quote(shellPath(script))} --start`),
  };
}

test("launcher validates all configurations and starts an independent immutable copy", t => {
  const fixture = launcherFixture(t);
  const result = fixture.execute();
  assert.equal(result.status, 0, result.stderr);
  const args = fs.readFileSync(path.join(fixture.directory, "launched"), "utf8");
  assert.match(result.stdout, /NGINX_TEMPLATE_VALIDATION_OK/);
  assert.match(args, /--no-block/);
  // systemd-run passes properties over D-Bus: zero is an immediate timeout.
  assert.match(args, /TimeoutStartSec=infinity/);
  assert.doesNotMatch(args, /TimeoutStartSec=0(?:\n|$)/);
  assert.match(args, /cutover-script\./);
  assert.match(args, /--apply/);
});

test("Nginx validation failure prevents the migration from being launched", t => {
  const fixture = launcherFixture(t, { nginxFails: true });
  const result = fixture.execute();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /UPSTREAM_TEMPLATE_TESTS_OK/);
  assert.equal(fs.existsSync(path.join(fixture.directory, "launched")), false);
});

test("an existing primary marker prevents replay", t => {
  const fixture = launcherFixture(t, { existing: true });
  const result = fixture.execute();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to repeat/);
  assert.equal(fs.existsSync(path.join(fixture.directory, "launched")), false);
});

for (const [name, committed, restartFails] of [
  ["pre-commit recovery restores old routing before reopening new writes", false, false],
  ["failed old-process recovery keeps writes paused", false, true],
  ["post-commit failure never restores the old primary", true, false],
]) {
  test(name, t => {
    const fixture = launcherFixture(t);
    const start = source.indexOf("rollback() {");
    const end = source.indexOf("\n}\ntrap 'rollback", start);
    assert.ok(start >= 0 && end > start);
    const rollback = source.slice(start, end + 2);
    const result = run(`
      RUN=${quote(shellPath(fixture.directory))}
      COMMITTED=${committed ? "yes" : "no"}
      MUTATED=yes; NEW_DB_REPLACED=no; OLD_STOPPED=yes
      log() { printf '%s\\n' "$*"; }
      systemctl() { printf '%s\\n' "service $*" >> "$RUN/actions"; }
      old() { printf '%s\\n' "old $*" >> "$RUN/actions"; return ${restartFails ? 1 : 0}; }
      old_upstream() { printf '%s\\n' "old_upstream $*" >> "$RUN/actions"; }
      local_upstream() { printf '%s\\n' "local_upstream $*" >> "$RUN/actions"; }
      sleep() { return 0; }
      ${rollback}
      (exit 17)
      rollback
    `);
    assert.equal(result.status, 17, result.stderr);
    const actionsFile = path.join(fixture.directory, "actions");
    const actions = fs.existsSync(actionsFile) ? fs.readFileSync(actionsFile, "utf8") : "";
    if (committed) {
      assert.equal(actions, "");
      assert.equal(fs.readFileSync(path.join(fixture.directory, "status"), "utf8").trim(), "COMMITTED_NEEDS_ATTENTION");
    } else if (restartFails) {
      assert.doesNotMatch(actions, /(?:old|local)_upstream/);
      assert.match(result.stdout, /keep writes paused/);
    } else {
      assert.match(actions, /old pm2 restart/);
      assert.ok(actions.indexOf("old_upstream local no") < actions.indexOf("local_upstream no"));
    }
  });
}

test("write-pause check uses verified HTTPS and rejects redirects", () => {
  const start = source.indexOf("new_writes_paused() {");
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start);
  const check = source.slice(start, end + 2);
  for (const code of ["503", "301", "302", "200"]) {
    const result = run(`
      curl() {
        [[ "$*" == *'--resolve fenglou1.com:443:127.0.0.1'* ]] || return 1
        [[ "${"${!#}"}" == https://fenglou1.com/__hulim_migration_write_probe__ ]] || return 1
        printf '%s' ${quote(code)}
      }
      ${check}
      new_writes_paused
    `);
    assert.equal(result.status === 0, code === "503", result.stderr);
  }
});

test("forwarding health retries transient failures and requires HTTP 200", t => {
  const fixture = launcherFixture(t);
  const start = source.indexOf("healthy_bridge() {");
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start);
  const check = source.slice(start, end + 2);
  for (const recovered of [true, false]) {
    const counter = path.join(fixture.directory, recovered ? "recovered-count" : "failed-count");
    fs.writeFileSync(counter, "0");
    const result = run(`
      counter=${quote(shellPath(counter))}
      old() {
        count=$(cat "$counter"); count=$((count + 1)); printf '%s' "$count" > "$counter"
        if [[ "$count" -gt 1 && ${recovered ? "yes" : "no"} == yes ]]; then printf '200'; else printf '502'; fi
      }
      log() { printf '%s\\n' "$*"; }
      sleep() { return 0; }
      ${check}
      healthy_bridge
    `);
    assert.equal(result.status === 0, recovered, result.stderr);
    assert.equal(fs.readFileSync(counter, "utf8"), recovered ? "2" : "3");
    assert.match(result.stdout, /HTTP=502/);
  }
});

test("new server readiness requires both application and HTTPS success", () => {
  const start = source.indexOf("healthy_new() {");
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start);
  const check = source.slice(start, end + 2);
  for (const tlsStatus of ["200", "500"]) {
    const result = run(`
      curl() { if [[ "$*" == *'https://fenglou1.com/'* ]]; then printf '%s' ${quote(tlsStatus)}; else printf '200'; fi; }
      seq() { printf '1\\n2\\n'; }
      log() { printf '%s\\n' "$*"; }
      sleep() { return 0; }
      ${check}
      healthy_new
    `);
    assert.equal(result.status === 0, tlsStatus === "200", result.stderr);
  }
});
