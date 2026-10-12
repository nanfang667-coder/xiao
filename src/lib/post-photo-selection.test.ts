import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { withSelectedPostPhotos } from "./post-photo-selection.ts";

const photo = (name: string, data = "synthetic") => new File([data], name, { type: "image/jpeg" });

test("photo submission replaces the native last selection with all ordered preview files", async () => {
  const form = new FormData();
  form.append("photos", photo("last-selection.jpg", "uncompressed-original"));
  form.append("name", "synthetic title");
  form.append("wechat", "fixture_contact");
  form.append("tag", "one");
  form.append("tag", "two");
  form.append("$ACTION_TEST", "bound-action-placeholder");
  const result = withSelectedPostPhotos(form, [photo("second.jpg", "compressed-2"), photo("first.jpg", "compressed-1")]);
  const files = result.getAll("photos") as File[];
  assert.equal(result, form);
  assert.deepEqual(files.map(file => file.name), ["second.jpg", "first.jpg"]);
  assert.deepEqual(await Promise.all(files.map(file => file.text())), ["compressed-2", "compressed-1"]);
  assert.equal(result.get("name"), "synthetic title");
  assert.equal(result.get("wechat"), "fixture_contact");
  assert.deepEqual(result.getAll("tag"), ["one", "two"]);
  assert.equal(result.get("$ACTION_TEST"), "bound-action-placeholder");
});

test("removing all new photos leaves no stale native file for create or edit submissions", () => {
  const form = new FormData();
  form.append("photos", photo("removed.jpg"));
  form.append("photos", new File([], ""));
  form.append("name", "edited fixture");
  withSelectedPostPhotos(form, []);
  assert.deepEqual(form.getAll("photos"), []);
  assert.equal(form.get("name"), "edited fixture");
});

test("preparing the same form again does not duplicate uploads or mutate the selected file queue", () => {
  const form = new FormData();
  const files = Object.freeze([photo("cover.jpg"), photo("detail.jpg")]);
  withSelectedPostPhotos(form, files);
  withSelectedPostPhotos(form, files);
  assert.deepEqual((form.getAll("photos") as File[]).map(file => file.name), ["cover.jpg", "detail.jpg"]);
  assert.deepEqual(files.map(file => file.name), ["cover.jpg", "detail.jpg"]);
});
