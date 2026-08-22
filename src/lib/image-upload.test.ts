import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { getSelectedPhotoFiles, ImageUploadError, MAX_PHOTO_COUNT, MAX_PHOTO_SIZE_BYTES, saveUploadedPhotos } from "./image-upload.ts";

test("ignores the empty file submitted when no photo is selected", () => {
  const formData = new FormData();
  formData.append(
    "photos",
    new File([], "", { type: "application/octet-stream" }),
  );

  assert.deepEqual(getSelectedPhotoFiles(formData), []);
});

test("ignores a zero-byte placeholder even when the runtime gives it a name", () => {
  const formData = new FormData();
  formData.append("photos", new File([], "blob", { type: "application/octet-stream" }));

  assert.deepEqual(getSelectedPhotoFiles(formData), []);
});

test("the image normalizer still rejects a direct empty file", async () => {
  const empty = new File([], "empty.jpg", { type: "image/jpeg" });
  await assert.rejects(() => saveUploadedPhotos([empty]), /空文件/);
});

test("decodes and re-encodes an allowed image as JPEG", async () => {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "hulim-upload-"));
  try {
    const png = await sharp({
      create: { width: 4, height: 3, channels: 4, background: "#ff00ff80" },
    })
      .png()
      .toBuffer();
    const pngBytes = new Uint8Array(png.byteLength);
    pngBytes.set(png);
    const file = new File([pngBytes], "misleading.txt", { type: "text/plain" });

    const [url] = await saveUploadedPhotos([file], targetDir);
    assert.match(url, /^\/uploads\/[0-9a-f-]{36}\.jpg$/);

    const stored = await readFile(path.join(targetDir, path.basename(url)));
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 4);
    assert.equal(metadata.height, 3);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("rejects content that only pretends to be an image", async () => {
  const fake = new File(["<script>alert(1)</script>"], "fake.jpg", { type: "image/jpeg" });
  await assert.rejects(() => saveUploadedPhotos([fake]), ImageUploadError);
});

test("rejects oversized files before decoding", async () => {
  const oversized = new File([new Uint8Array(MAX_PHOTO_SIZE_BYTES + 1)], "large.jpg", {
    type: "image/jpeg",
  });
  await assert.rejects(() => saveUploadedPhotos([oversized]), /超过 5MB/);
});

test("rejects too many files", async () => {
  const files = Array.from(
    { length: MAX_PHOTO_COUNT + 1 },
    (_, index) => new File(["x"], `${index}.jpg`, { type: "image/jpeg" }),
  );
  await assert.rejects(() => saveUploadedPhotos(files), /一次最多上传/);
});