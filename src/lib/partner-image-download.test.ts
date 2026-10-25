import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { createPartnerImageDownloader, PartnerImageDownloadError } from "./partner-image-download.ts";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { PartnerFetchError } from "./partner-import-fetch.ts";

const urls = ["https://media.example/one", "https://media.example/two"];
const origins = ["https://media.example"];
const png = () => sharp({ create: { width: 2000, height: 10, channels: 4, background: "#00000000" } }).png().toBuffer();

test("downloads and transcodes sequentially to bounded opaque JPEG bytes without persisting files", async () => {
  const input = await png();
  const calls: string[] = [];
  let active = 0;
  const download = createPartnerImageDownloader(async (url, allowed, options) => {
    assert.equal(++active, 1);
    assert.deepEqual(allowed, origins);
    assert.equal(options?.accept, "image");
    assert.equal(options?.maxBytes, 5 * 1024 * 1024);
    calls.push(url);
    await Promise.resolve();
    active--;
    return { bytes: input, contentType: "image/png", url };
  });
  const result = await download(urls, origins);
  assert.deepEqual(calls, urls);
  assert.equal(result.length, 2);
  for (const image of result) {
    assert.deepEqual(Object.keys(image).sort(), ["bytes", "hash"]);
    assert.equal(image.hash, createHash("sha256").update(image.bytes).digest("hex"));
    const metadata = await sharp(image.bytes).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.hasAlpha, false);
    const { data } = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data.every(channel => channel >= 250));
  }
});

test("rejects empty and oversized batches before opening any network connection", async () => {
  const download = createPartnerImageDownloader(async () => { throw new Error("must not fetch"); });
  await assert.rejects(download([], origins), { code: "NO_PHOTOS" });
  await assert.rejects(download(Array(9).fill(urls[0]), origins), { code: "DETAIL_LIMIT" });
});

test("content is decoded rather than trusting the HTTP MIME or file name", async () => {
  const privateContent = "SYNTHETIC_PRIVATE_HTML";
  const download = createPartnerImageDownloader(async url => ({
    bytes: Buffer.from(privateContent), contentType: "image/jpeg", url,
  }));
  await assert.rejects(download([urls[0]], origins), (error: unknown) => {
    assert.ok(error instanceof PartnerImageDownloadError);
    assert.equal(error.code, "INVALID_IMAGE");
    assert.equal(String(error).includes(privateContent), false);
    return true;
  });
});

test("enforces per-image and cumulative source-byte limits", async () => {
  const input = await png();
  const tooBig = createPartnerImageDownloader(async url => ({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: "image/png", url }));
  await assert.rejects(tooBig([urls[0]], origins), { code: "TOO_LARGE" });
  const padded = Buffer.concat([input, Buffer.alloc(5 * 1024 * 1024 - input.length)]);
  const download = createPartnerImageDownloader(async url => ({ bytes: padded, contentType: "image/png", url }));
  await assert.rejects(download([...urls, urls[0]], origins), { code: "TOO_LARGE" });
});

test("a failed image rejects the whole post and does not fetch subsequent images", async () => {
  const calls: string[] = [];
  const download = createPartnerImageDownloader(async url => {
    calls.push(url);
    throw new PartnerFetchError("ORIGIN_NOT_ALLOWED");
  });
  await assert.rejects(download(urls, origins), { code: "ORIGIN_NOT_ALLOWED" });
  assert.deepEqual(calls, [urls[0]]);
});

test("cancellation is forwarded to transport and stops subsequent images", async () => {
  const controller = new AbortController();
  const input = await png();
  const calls: string[] = [];
  const download = createPartnerImageDownloader(async (url, _origins, options) => {
    assert.equal(options?.signal, controller.signal);
    calls.push(url);
    controller.abort();
    return { bytes: input, contentType: "image/png", url };
  });
  await assert.rejects(download(urls, origins, { signal: controller.signal }), { code: "TIMEOUT" });
  assert.deepEqual(calls, [urls[0]]);
  const alreadyAborted = createPartnerImageDownloader(async () => { throw new Error("must not fetch"); });
  await assert.rejects(alreadyAborted(urls, origins, { signal: controller.signal }), { code: "TIMEOUT" });
});
