import assert from "node:assert/strict";
import test from "node:test";
import {
  getChinaCalendarMonthRange,
  getTeamMonthlyPostUsageWhere,
  parseTeamMonthlyPostLimit,
  summarizeTeamPostQuota,
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
} from "./team-post-quota.ts";

test("accepts only the two administrator-selectable monthly limits", () => {
  assert.equal(parseTeamMonthlyPostLimit("30"), 30);
  assert.equal(parseTeamMonthlyPostLimit(150), 150);
  assert.equal(parseTeamMonthlyPostLimit("31"), null);
  assert.equal(parseTeamMonthlyPostLimit(""), null);
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
