import assert from "node:assert/strict";
import test from "node:test";
import {
  getChinaCalendarMonthRange,
  getChinaCalendarMonthKey,
  getEffectiveTeamMonthlyPostLimit,
  getTeamMonthlyPostBaseLimit,
  getTeamMonthlyPostUsageWhere,
  parseNewTeamMonthlyPostLimit,
  parseTeamMonthlyPostLimit,
  summarizeTeamPostQuota,
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
} from "./team-post-quota.ts";

test("keeps legacy limits valid but restricts new accounts to 22 or 150", () => {
  assert.equal(parseTeamMonthlyPostLimit("22"), 22);
  assert.equal(parseTeamMonthlyPostLimit("30"), 30);
  assert.equal(parseTeamMonthlyPostLimit(150), 150);
  assert.equal(parseTeamMonthlyPostLimit("31"), null);
  assert.equal(parseTeamMonthlyPostLimit(""), null);
  assert.equal(parseNewTeamMonthlyPostLimit("22"), 22);
  assert.equal(parseNewTeamMonthlyPostLimit("150"), 150);
  assert.equal(parseNewTeamMonthlyPostLimit("30"), null);
});

test("uses Beijing calendar-month boundaries", () => {
  const september = getChinaCalendarMonthRange(
    new Date("2026-09-30T15:59:59.999Z"),
  );
  assert.equal(september.start.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(september.end.toISOString(), "2026-09-30T16:00:00.000Z");

  const october = getChinaCalendarMonthRange(
    new Date("2026-09-30T16:00:00.000Z"),
  );
  assert.equal(october.start.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(october.end.toISOString(), "2026-10-31T16:00:00.000Z");
});

test("counts only new pending and approved submissions in the month", () => {
  const where = getTeamMonthlyPostUsageWhere(
    12,
    new Date("2026-09-15T00:00:00.000Z"),
  );
  assert.equal(where.teamAccountId, 12);
  assert.equal(where.kind, "create");
  assert.deepEqual(where.status, { in: ["pending", "approved"] });
  assert.deepEqual(where.createdAt, {
    gte: new Date("2026-08-31T16:00:00.000Z"),
    lt: new Date("2026-09-30T16:00:00.000Z"),
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

test("uses a bonus only during its Beijing calendar month", () => {
  const september = new Date("2026-09-30T15:59:59.999Z");
  const october = new Date("2026-09-30T16:00:00.000Z");
  const account = {
    monthlyPostLimit: 30,
    monthlyPostLimitOverride: null,
    monthlyPostBonus: 8,
    monthlyPostBonusMonth: "2026-09",
  };

  assert.equal(getChinaCalendarMonthKey(september), "2026-09");
  assert.equal(getChinaCalendarMonthKey(october), "2026-10");
  assert.equal(getEffectiveTeamMonthlyPostLimit(account, september), 38);
  assert.equal(getEffectiveTeamMonthlyPostLimit(account, october), 30);
});

test("uses the override for new accounts without changing legacy base values", () => {
  assert.equal(
    getTeamMonthlyPostBaseLimit({
      monthlyPostLimit: 30,
      monthlyPostLimitOverride: null,
    }),
    30,
  );
  assert.equal(
    getTeamMonthlyPostBaseLimit({
      monthlyPostLimit: 30,
      monthlyPostLimitOverride: 22,
    }),
    22,
  );
  assert.equal(
    getTeamMonthlyPostBaseLimit({
      monthlyPostLimit: 150,
      monthlyPostLimitOverride: 150,
    }),
    150,
  );
});
