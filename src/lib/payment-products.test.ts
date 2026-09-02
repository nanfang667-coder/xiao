import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { ALLEY_POST_PRODUCT_TYPE, ALLEY_UNLOCK_PLAN, MEMBERSHIP_PRODUCT_TYPE, TEACHER_POST_PRODUCT_TYPE, TEACHER_UNLOCK_PLAN, isValidOrderProductTarget, paidOrderDestination } from "./payment-products.ts";

test("routes a paid membership order to the VIP success page", () => {
  assert.equal(
    paidOrderDestination(MEMBERSHIP_PRODUCT_TYPE, null, null),
    "/vip?paid=1",
  );
});

test("routes a paid alley order back to its unlocked post", () => {
  assert.equal(
    paidOrderDestination(ALLEY_POST_PRODUCT_TYPE, 28, null),
    "/alley/28?paid=1",
  );
});

test("routes a paid teacher order back to its unlocked post", () => {
  assert.equal(
    paidOrderDestination(TEACHER_POST_PRODUCT_TYPE, null, 38),
    "/listing/38?paid=1",
  );
});

test("rejects malformed or mixed payment products", () => {
  assert.equal(paidOrderDestination(ALLEY_POST_PRODUCT_TYPE, null, null), null);
  assert.equal(paidOrderDestination(ALLEY_POST_PRODUCT_TYPE, 0, null), null);
  assert.equal(paidOrderDestination(TEACHER_POST_PRODUCT_TYPE, null, 0), null);
  assert.equal(paidOrderDestination(TEACHER_POST_PRODUCT_TYPE, 28, 38), null);
  assert.equal(paidOrderDestination("unknown", 28, null), null);
});

test("uses the payment channel minimum for both single-post unlocks", () => {
  assert.equal(ALLEY_UNLOCK_PLAN.price, 10);
  assert.equal(TEACHER_UNLOCK_PLAN.price, 10);
});

test("validates product and target combinations", () => {
  assert.equal(
    isValidOrderProductTarget(MEMBERSHIP_PRODUCT_TYPE, null, null),
    true,
  );
  assert.equal(
    isValidOrderProductTarget(MEMBERSHIP_PRODUCT_TYPE, 28, null),
    false,
  );
  assert.equal(
    isValidOrderProductTarget(ALLEY_POST_PRODUCT_TYPE, 28, null),
    true,
  );
  assert.equal(
    isValidOrderProductTarget(ALLEY_POST_PRODUCT_TYPE, null, null),
    false,
  );
  assert.equal(
    isValidOrderProductTarget(TEACHER_POST_PRODUCT_TYPE, null, 38),
    true,
  );
  assert.equal(
    isValidOrderProductTarget(TEACHER_POST_PRODUCT_TYPE, 28, 38),
    false,
  );
});
