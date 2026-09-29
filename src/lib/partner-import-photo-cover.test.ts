import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { DEFAULT_PARTNER_PHOTO_COVER, parsePartnerPhotoCover, parsePartnerPhotoCoverForm, readPartnerPhotoCover, type PartnerPhotoCover } from "./partner-import-photo-cover.ts";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { renderPartnerPhotoCover } from "./partner-import-photo-cover-render.ts";

const config: PartnerPhotoCover = { ...DEFAULT_PARTNER_PHOTO_COVER, text: "site.example" };
const storedFields = JSON.stringify({ name: "虚构待审稿", _photoCover: config });
const syntheticImage = () => sharp({ create: { width: 200, height: 100, channels: 3, background: "#00cc55" } }).png().toBuffer();

test("cover settings have a bounded independent copy and default to disabled", () => {
  assert.equal(parsePartnerPhotoCover(null), null);
  assert.equal(parsePartnerPhotoCover(undefined), null);
  assert.deepEqual(parsePartnerPhotoCover(config), config);
  assert.notEqual(parsePartnerPhotoCover(config), config);
  assert.equal(readPartnerPhotoCover('{"services":"虚构正文"}'), null);
  assert.deepEqual(readPartnerPhotoCover(storedFields), config);
});

test("only domain names and explicit HTTP(S) addresses are displayed as supplied", () => {
  for (const text of ["site.example", "SITE.example", "https://site.example", "http://site.example/path?one=1&two=2#anchor"]) {
    assert.equal(parsePartnerPhotoCover({ ...config, text })?.text, text);
  }
  for (const text of ["", " site.example", "site.example ", "site.example/path", "site.example:3000",
    "javascript:alert(1)", "file:///secret", "https://user:secret@site.example", "https://site.example\n",
    "https://site.example/<svg>", 'https://site.example/"', "https://site.example/\\secret",
    "https://localhost/path", "https://127.0.0.1", "网站.example", "https://" + "a".repeat(100) + ".example"]) {
    assert.throws(() => parsePartnerPhotoCover({ ...config, text }), /^Error: INVALID_PHOTO_COVER$/);
  }
});

test("cover settings reject missing, unknown and coerced values", () => {
  for (const value of [false, "null", [], {}, { ...config, extra: true },
    { ...config, position: "middle" }, { ...config, align: { toString: () => "left" } },
    { ...config, widthPercent: "100" }, { ...config, widthPercent: 24 }, { ...config, widthPercent: 101 },
    { ...config, heightPercent: 4 }, { ...config, heightPercent: 41 }, { ...config, heightPercent: 10.5 },
    { ...config, heightPercent: NaN }, Object.assign(Object.create({ inherited: true }), config)]) {
    assert.throws(() => parsePartnerPhotoCover(value), /^Error: INVALID_PHOTO_COVER$/);
  }
});

test("forms preserve absent settings, support explicit off, and reject malformed or repeated input", () => {
  const form = new FormData();
  assert.deepEqual(parsePartnerPhotoCoverForm(form, storedFields), config);
  form.set("photoCover", "null");
  assert.equal(parsePartnerPhotoCoverForm(form, storedFields), null);
  form.set("photoCover", JSON.stringify({ ...config, align: "left" }));
  assert.equal(parsePartnerPhotoCoverForm(form, storedFields)?.align, "left");
  form.append("photoCover", "null");
  assert.throws(() => parsePartnerPhotoCoverForm(form, storedFields), /INVALID_PHOTO_COVER/);
  for (const text of ["", "{", "false", "[]", "x".repeat(513)]) {
    form.set("photoCover", text);
    assert.throws(() => parsePartnerPhotoCoverForm(form, storedFields), /INVALID_PHOTO_COVER/);
  }
  form.set("photoCover", new Blob(["null"]), "settings.txt");
  assert.throws(() => parsePartnerPhotoCoverForm(form, storedFields), /INVALID_PHOTO_COVER/);
  for (const stored of ["", "null", "[]", "{", '{"_photoCover":false}']) {
    assert.throws(() => readPartnerPhotoCover(stored), /INVALID_PHOTO_COVER/);
  }
});

async function pixel(image: Buffer, x: number, y: number): Promise<number[]> {
  const bytes = await sharp(image).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  return [...bytes];
}

function nearPixel(actual: number[], expected: number[]) {
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 8), JSON.stringify(actual));
}

test("render covers the requested pixels opaquely, leaves surrounding areas and preserves original bytes", async () => {
  const source = await syntheticImage();
  const before = Buffer.from(source);
  const output = await renderPartnerPhotoCover(source, { ...config, widthPercent: 50, heightPercent: 20 });
  assert.deepEqual(source, before);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 200);
  assert.equal(metadata.height, 100);
  nearPixel(await pixel(output, 55, 85), [23, 32, 51]);
  nearPixel(await pixel(output, 10, 90), [0, 204, 85]);
  nearPixel(await pixel(output, 190, 90), [0, 204, 85]);
  nearPixel(await pixel(output, 100, 60), [0, 204, 85]);
  const covered = await sharp(output).extract({ left: 50, top: 80, width: 100, height: 20 }).removeAlpha().raw().toBuffer();
  assert.ok(Array.from({ length: covered.length / 3 }, (_, index) =>
    covered[index * 3] > 200 && covered[index * 3 + 1] > 200 && covered[index * 3 + 2] > 200).some(Boolean), "website text is rendered");
});

test("all top/bottom and horizontal alignments have matching coverage geometry", async () => {
  const source = await syntheticImage();
  for (const position of ["top", "bottom"] as const) {
    for (const align of ["left", "center", "right"] as const) {
      const output = await renderPartnerPhotoCover(source, { ...config, position, align, widthPercent: 50, heightPercent: 20 });
      const left = align === "left" ? 0 : align === "right" ? 100 : 50;
      const top = position === "top" ? 0 : 80;
      nearPixel(await pixel(output, left + 5, top + 5), [23, 32, 51]);
      nearPixel(await pixel(output, left + 5, position === "top" ? 60 : 20), [0, 204, 85]);
    }
  }
});

test("URL query ampersands render safely without interpreting markup", async () => {
  const output = await renderPartnerPhotoCover(await syntheticImage(), {
    ...config, text: "https://site.example/path?one=1&two=2",
  });
  assert.equal((await sharp(output).metadata()).format, "jpeg");
  await assert.rejects(() => renderPartnerPhotoCover(Buffer.from("private input text"), {
    ...config, text: 'https://site.example/<image href="file:///private"/>',
  }), /^Error: INVALID_PHOTO_COVER$/);
});

test("EXIF orientation is normalized before positioning the cover", async () => {
  const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#00cc55" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const output = await renderPartnerPhotoCover(source, { ...config, heightPercent: 20 });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 100);
  assert.equal(metadata.height, 200);
  assert.equal(metadata.orientation, undefined);
  nearPixel(await pixel(output, 5, 170), [23, 32, 51]);
  nearPixel(await pixel(output, 5, 50), [0, 204, 85]);
});

test("invalid, oversized and unsupported inputs yield a fixed private error", async () => {
  for (const source of [
    Buffer.alloc(0), Buffer.from("private filename and metadata must not leak"),
    Buffer.alloc(5 * 1024 * 1024 + 1),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>'),
  ]) {
    await assert.rejects(() => renderPartnerPhotoCover(source, config), /^Error: INVALID_PHOTO_COVER_IMAGE$/);
  }
});

test("pending defaults distinguish missing settings from explicit off and keep history unchanged", () => {
  const legacy = '{"services":"虚构正文"}';
  assert.deepEqual(readPartnerPhotoCover(legacy, true), DEFAULT_PARTNER_PHOTO_COVER);
  assert.notEqual(readPartnerPhotoCover(legacy, true), DEFAULT_PARTNER_PHOTO_COVER);
  assert.equal(readPartnerPhotoCover(legacy), null);
  assert.equal(readPartnerPhotoCover('{"_photoCover":null}', true), null);
  assert.deepEqual(readPartnerPhotoCover(storedFields, true), config);
  assert.deepEqual(parsePartnerPhotoCoverForm(new FormData(), legacy), DEFAULT_PARTNER_PHOTO_COVER);
  assert.equal(parsePartnerPhotoCoverForm(new FormData(), '{"_photoCover":null}'), null);
  assert.throws(() => readPartnerPhotoCover('{"_photoCover":false}', true), /INVALID_PHOTO_COVER/);
});
