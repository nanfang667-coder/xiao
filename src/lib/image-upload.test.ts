import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
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

async function temporaryUploadDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hulim-image-upload-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith("hulim-image-upload-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("uploaded PNGs become bounded, opaque JPEGs with the upgraded image decoder", async (t) => {
  const directory = await temporaryUploadDirectory(t);
  const png = await sharp({
    create: { width: 2000, height: 20, channels: 4, background: "#00000000" },
  }).png().toBuffer();
  const urls = await saveUploadedPhotos([new File([new Uint8Array(png)], "synthetic.png", { type: "image/png" })], directory);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/uploads\/[a-f0-9-]+\.jpg$/);
  const image = await readFile(path.join(directory, path.basename(urls[0])));
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.ok(metadata.width && metadata.width <= 1600);
  assert.ok(metadata.height && metadata.height <= 1600);
  assert.equal(metadata.hasAlpha, false);
  const { data } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data.every((channel) => channel >= 250), "transparent input is flattened onto white");
});

test("a malformed upload rejects the batch before any image is written", async (t) => {
  const directory = await temporaryUploadDirectory(t);
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "white" },
  }).png().toBuffer();
  await assert.rejects(saveUploadedPhotos([
    new File([new Uint8Array(png)], "valid.png", { type: "image/png" }),
    new File(["synthetic invalid image"], "invalid.jpg", { type: "image/jpeg" }),
  ], directory), ImageUploadError);
  assert.deepEqual(await readdir(directory), []);
});
