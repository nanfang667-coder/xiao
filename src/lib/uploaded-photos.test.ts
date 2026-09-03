import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { isSafeUploadedPhotoFilename } from "./uploaded-photos.ts";

test("accepts uploaded raster image filenames", () => {
  assert.equal(
    isSafeUploadedPhotoFilename("ed494ba1-98ab-47dc-8191-e1109a5e4a6d.jpg"),
    true,
  );
  assert.equal(isSafeUploadedPhotoFilename("legacy-image.WEBP"), true);
});

test("rejects traversal and executable image formats", () => {
  assert.equal(isSafeUploadedPhotoFilename("../secret.jpg"), false);
  assert.equal(isSafeUploadedPhotoFilename("payload.svg"), false);
  assert.equal(isSafeUploadedPhotoFilename("photo.jpg.exe"), false);
});
