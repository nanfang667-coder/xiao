import assert from "node:assert/strict";
import test from "node:test";
import {
  getEffectiveTeamPostLimit,
  getTeamPostBaseLimit,
  getTeamPostUsageWhere,
  parseNewTeamPostLimit,
  parseTeamPostLimit,
  summarizeTeamPostQuota,
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
} from "./team-post-quota.ts";

test("keeps legacy limits valid but restricts new accounts to 22 or 150", () => {
  assert.equal(parseTeamPostLimit("22"), 22);
  assert.equal(parseTeamPostLimit("30"), 30);
  assert.equal(parseTeamPostLimit(150), 150);
  assert.equal(parseTeamPostLimit("31"), null);
  assert.equal(parseTeamPostLimit(""), null);
  assert.equal(parseNewTeamPostLimit("22"), 22);
  assert.equal(parseNewTeamPostLimit("150"), 150);
  assert.equal(parseNewTeamPostLimit("30"), null);
});

test("counts retained pending and approved new submissions without a date cutoff", () => {
  assert.deepEqual(getTeamPostUsageWhere(12), {
    teamAccountId: 12,
    kind: "create",
    status: { in: ["pending", "approved"] },
  });
  assert.deepEqual(getTeamPostUsageWhere(), {
    kind: "create",
    status: { in: ["pending", "approved"] },
  });
});

test("reports remaining quota without going below zero", () => {
  assert.deepEqual(summarizeTeamPostQuota(30, 12), {
    limit: 30,
    used: 12,
    remaining: 18,
    exhausted: false,
  });
  assert.equal(summarizeTeamPostQuota(30, 31).remaining, 0);
  assert.equal(summarizeTeamPostQuota(30, 31).exhausted, true);
});

test("month and year rollover keep the remaining quota and stored bonus", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T15:59:59.999Z") });
  const account = {
    monthlyPostLimit: 150,
    monthlyPostLimitOverride: null,
    monthlyPostBonus: 0,
    monthlyPostBonusMonth: "2026-09",
  };
  const balance = () => summarizeTeamPostQuota(getEffectiveTeamPostLimit(account), 100);
  const before = balance();
  assert.equal(before.remaining, 50);
  t.mock.timers.tick(1);
  assert.deepEqual(balance(), before);
  t.mock.timers.setTime(new Date("2027-01-01T00:00:00Z").getTime());
  assert.deepEqual(balance(), before);
  account.monthlyPostBonus = 8;
  assert.equal(balance().remaining, 58);
  t.mock.timers.setTime(new Date("2028-01-01T00:00:00Z").getTime());
  assert.equal(balance().remaining, 58);
});

test("uses the override for new accounts without changing legacy base values", () => {
  assert.equal(
    getTeamPostBaseLimit({
      monthlyPostLimit: 30,
      monthlyPostLimitOverride: null,
    }),
    30,
  );
  assert.equal(
    getTeamPostBaseLimit({
      monthlyPostLimit: 30,
      monthlyPostLimitOverride: 22,
    }),
    22,
  );
  assert.equal(
    getTeamPostBaseLimit({
      monthlyPostLimit: 150,
      monthlyPostLimitOverride: 150,
    }),
    150,
  );
});
