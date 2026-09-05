import assert from "node:assert/strict";
import test from "node:test";
import {
  getChinaCalendarDayRange,
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
} from "./china-calendar.ts";

test("uses Beijing midnight boundaries for today's range", () => {
  const beforeMidnight = getChinaCalendarDayRange(
    new Date("2026-09-05T15:59:59.999Z"),
  );
  assert.equal(beforeMidnight.start.toISOString(), "2026-09-04T16:00:00.000Z");
  assert.equal(beforeMidnight.end.toISOString(), "2026-09-05T16:00:00.000Z");

  const afterMidnight = getChinaCalendarDayRange(
    new Date("2026-09-05T16:00:00.000Z"),
  );
  assert.equal(afterMidnight.start.toISOString(), "2026-09-05T16:00:00.000Z");
  assert.equal(afterMidnight.end.toISOString(), "2026-09-06T16:00:00.000Z");
});
