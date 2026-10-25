import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Only code is read; all authentication, source data and remote transport are synthetic.
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Buffer, TextDecoder, TextEncoder, Uint8Array, DataView, Uint32Array, AbortSignal, ...globals,
    require(name) { assert.ok(Object.hasOwn(mocks, name), "Unmocked dependency: " + name); return mocks[name]; } });
  return exports;
}
const origin = "https://partner.example";
const imageOrigin = "https://images.example";
const privateSentinel = "SYNTHETIC_PRIVATE_SOURCE_BODY";
const errorsApi = load("src/lib/partner-import-errors.ts");
const apiAdapter = await import("../src/lib/partner-66feng-images.ts");
const paginationCodes = ["INVALID_PAGINATION", "AMBIGUOUS_PAGINATION", "UNSAFE_PAGINATION", "PAGINATION_LOOP"];
function fixture(options = {}) {
  const calls = [];
  const rules = { postLinkSelector: "article a", photoSelector: "article img", ...options.rules };
  const api = load("src/lib/partner-images.ts", {
    "server-only": {},
    "./prisma": { prisma: { partnerImportSource: { findUnique: async query => {
      calls.push(["source", query]);
      if (options.dbError) throw new Error(privateSentinel);
      return options.missing ? null : { origin, rules: JSON.stringify(rules), imageOrigins: JSON.stringify([imageOrigin]), ...options.source };
    } } } },
    "./partner-import-parser": {
      normalizePartnerImportRules: value => { calls.push(["rules", value]); return value; },
      parsePartnerListing: (...args) => { calls.push(["list", ...args]); return options.listUrls ?? [origin + "/post/1", origin + "/post/2"]; },
    },
    "./partner-image-pagination": {
      partnerImageStartPageUrl: (...args) => {
        calls.push(["start-page", ...args]);
        if (options.startError) throw options.startError;
        return options.startUrl ?? args[0];
      },
      parsePartnerImageNextPage: (...args) => {
        calls.push(["next-page", ...args]);
        if (options.nextError) throw options.nextError;
        return typeof options.nextPageUrl === "function" ? options.nextPageUrl(args[3])
          : options.nextPageUrl === undefined ? origin + "/page/2" : options.nextPageUrl;
      },
    },
    "./partner-image-parser": { parsePartnerImageDetail: (...args) => {
      calls.push(["photos", ...args]); return { photoUrls: [imageOrigin + "/synthetic.jpg"] };
    } },
    "./partner-import-fetch": { fetchPartnerResource: async (...args) => {
      calls.push(["fetch", ...args]);
      if (options.fetchError) throw options.fetchError;
      return { bytes: options.responseBytes ?? Buffer.from("synthetic-page"), contentType: options.contentType ?? "text/html; charset=utf-8",
        url: typeof options.canonicalUrl === "function" ? options.canonicalUrl(args[0]) : options.canonicalUrl ?? origin + "/canonical" };
    } },
    "./partner-image-download": { downloadPartnerImageBytes: async (...args) => {
      calls.push(["download", ...args]);
      if (options.downloadError) throw options.downloadError;
      return [{ bytes: Buffer.from([255, 216, 255, 217]), hash: "synthetic-hash" }];
    } },
    "./partner-import-errors": errorsApi,
    "./partner-66feng-images": apiAdapter,
  }, { AbortSignal: { timeout: milliseconds => {
    calls.push(["timeout", milliseconds]);
    return AbortSignal.timeout(milliseconds);
  } } });
  return { api, calls };
}

test("the supported API source reads exactly one fixed public list and returns per-article photo hints", async () => {
  const site = "https://66feng.com";
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const body = { code: 0, data: [{ uuid, title: privateSentinel, description: privateSentinel,
    images: { cover: "", images: ["/synthetic.jpg"] } }], page: 1, page_size: 24, total: 70 };
  for (const mode of ["list", "three"]) {
    const { api, calls } = fixture({ source: { origin: site }, responseBytes: Buffer.from(JSON.stringify(body)),
      rules: { postLinkSelector: "THIS_SELECTOR_IS_NOT_USED", pageUrlTemplate: "?page={page}" } });
    const result = await api.planPartnerImageBatch(1, site + "/list?city_id=110000", mode, 1);
    const fetched = calls.filter(call => call[0] === "fetch");
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0][1], site + "/api/base/public/post/list");
    assert.deepEqual(Array.from(fetched[0][2]), [site]);
    assert.equal(fetched[0][3].accept, "json");
    assert.equal(fetched[0][3].maxBytes, 1_500_000);
    assert.deepEqual(JSON.parse(fetched[0][3].jsonBody), { page: 1, city_id: "110000", post_type: [0] });
    const detail = site + "/show?uuid=" + uuid;
    assert.deepEqual(Array.from(result.urls), [detail]);
    assert.deepEqual(Array.from(result.photoHints[detail]), [site + "/synthetic.jpg"]);
    assert.equal(result.nextPageUrl, mode === "three" ? site + "/list?city_id=110000&page=2&post_type=0" : null);
    assert.equal(JSON.stringify(result).includes(privateSentinel), false);
    assert.equal(calls.some(call => ["list", "photos", "download", "start-page", "next-page"].includes(call[0])), false);
  }
});

test("API three-page planning starts at page one and uses response pagination without reading a fourth page", async () => {
  const site = "https://66feng.com";
  for (const [pageNumber, expectedPage] of [[1, 1], [2, 2], [3, 3]]) {
    const { api, calls } = fixture({ source: { origin: site }, responseBytes: Buffer.from(JSON.stringify({
      code: 0, data: [{ uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", images: { cover: "", images: [] } }],
      page: expectedPage, page_size: 24, total: 100,
    })) });
    const result = await api.planPartnerImageBatch(1, site + "/list?city_id=110000&page=" + (pageNumber === 1 ? 99 : pageNumber), "three", pageNumber);
    assert.equal(JSON.parse(calls.find(call => call[0] === "fetch")[3].jsonBody).page, expectedPage);
    assert.equal(result.nextPageUrl, pageNumber === 3 ? null : site + "/list?city_id=110000&page=" + (expectedPage + 1) + "&post_type=0");
    assert.equal(calls.filter(call => call[0] === "fetch").length, 1);
    assert.deepEqual(Array.from(Object.values(result.photoHints)[0]), []);
  }
});

test("API failures do not fall back to HTML or expose the response body", async () => {
  const site = "https://66feng.com";
  const { api, calls } = fixture({ source: { origin: site }, responseBytes: Buffer.from(JSON.stringify({ msg: privateSentinel })) });
  await assert.rejects(api.planPartnerImageBatch(1, site + "/list?city_id=110000", "list"), error => {
    assert.equal(api.partnerImagesMessage(error).includes(privateSentinel), false);
    assert.match(api.partnerImagesMessage(error), /列表数据结构/);
    return true;
  });
  assert.equal(calls.filter(call => call[0] === "fetch").length, 1);
  assert.equal(calls.some(call => ["list", "photos", "download"].includes(call[0])), false);
});

test("compatible single-article wrapper reads only selected source config without a job or fetch", async () => {
  const { api, calls } = fixture();
  assert.deepEqual(Array.from(await api.planPartnerImagePages(1, origin + "/post/1", "detail")), [origin + "/post/1"]);
  assert.deepEqual(calls.map(call => call[0]), ["source", "rules"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    where: { id: 1 }, select: { origin: true, rules: true, imageOrigins: true },
  });
});

test("list planning uses bounded same-origin HTML and final redirected URL for parsing", async () => {
  const { api, calls } = fixture();
  assert.equal((await api.planPartnerImagePages(1, origin + "/list?page=2", "list")).length, 2);
  const fetch = calls.find(call => call[0] === "fetch");
  assert.equal(fetch[1], origin + "/list?page=2");
  assert.deepEqual(Array.from(fetch[2]), [origin]);
  assert.equal(fetch[3].accept, "html");
  assert.equal(fetch[3].maxBytes, 2_000_000);
  assert.ok(fetch[3].signal instanceof AbortSignal);
  assert.deepEqual(calls.filter(call => call[0] === "timeout"), [["timeout", 25_000]]);
  assert.equal(calls.find(call => call[0] === "list")[2], origin + "/canonical");
  assert.equal(calls.some(call => call[0] === "start-page" || call[0] === "next-page"), false);
});

test("batch planning preserves detail/list modes without implicitly reading more than one page", async () => {
  for (const mode of ["detail", "list"]) {
    const { api, calls } = fixture();
    const url = origin + (mode === "detail" ? "/post/1" : "/list?page=2");
    const result = await api.planPartnerImageBatch(1, url, mode);
    assert.deepEqual(Array.from(result.urls), mode === "detail" ? [url] : [origin + "/post/1", origin + "/post/2"]);
    assert.equal(result.pageUrl, mode === "detail" ? url : origin + "/canonical");
    assert.equal(result.nextPageUrl, null);
    assert.equal(calls.filter(call => call[0] === "fetch").length, mode === "detail" ? 0 : 1);
    assert.equal(calls.some(call => call[0] === "start-page" || call[0] === "next-page" || call[0] === "download"), false);
  }
});

test("three-page planning starts through the configured template and returns one canonical page plus its next URL", async () => {
  const { api, calls } = fixture({
    rules: { pageUrlTemplate: "/list?page={page}" },
    startUrl: origin + "/list?page=1", canonicalUrl: origin + "/list/?page=1", nextPageUrl: origin + "/list?page=2",
  });
  const result = await api.planPartnerImageBatch(1, origin + "/list?page=99", "three", 1);
  assert.deepEqual(Array.from(result.urls), [origin + "/post/1", origin + "/post/2"]);
  assert.equal(result.pageUrl, origin + "/list/?page=1");
  assert.equal(result.nextPageUrl, origin + "/list?page=2");
  const start = calls.find(call => call[0] === "start-page");
  assert.equal(start[1], origin + "/list?page=99");
  assert.equal(start[2].pageUrlTemplate, "/list?page={page}");
  const fetches = calls.filter(call => call[0] === "fetch");
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0][1], origin + "/list?page=1");
  assert.deepEqual(Array.from(fetches[0][2]), [origin]);
  assert.equal(fetches[0][3].maxBytes, 2_000_000);
  assert.ok(fetches[0][3].signal instanceof AbortSignal);
  assert.deepEqual(calls.filter(call => call[0] === "timeout"), [["timeout", 25_000]]);
  const next = calls.find(call => call[0] === "next-page");
  assert.equal(next[1], "synthetic-page");
  assert.equal(next[2], result.pageUrl);
  assert.equal(next[4], 2);
  assert.equal(calls.some(call => call[0] === "download"), false);
});

test("three-page continuation fetches exactly its supplied page and never resets to the start template", async () => {
  for (const pageNumber of [2, 3]) {
    const url = origin + "/list?page=" + pageNumber;
    const { api, calls } = fixture({ canonicalUrl: current => current,
      nextPageUrl: next => origin + "/list?page=" + next });
    const result = await api.planPartnerImageBatch(1, url, "three", pageNumber);
    assert.equal(result.pageUrl, url);
    assert.equal(result.nextPageUrl, pageNumber === 2 ? origin + "/list?page=3" : null);
    assert.equal(calls.some(call => call[0] === "start-page"), false);
    assert.deepEqual(calls.filter(call => call[0] === "fetch").map(call => call[1]), [url]);
    assert.equal(calls.filter(call => call[0] === "next-page").length, pageNumber === 2 ? 1 : 0);
    if (pageNumber === 2) assert.equal(calls.find(call => call[0] === "next-page")[4], 3);
  }
});

test("the third page never inspects next links and a missing next link is reported as an actual early end", async () => {
  const last = fixture({ nextError: new Error(privateSentinel) });
  const result = await last.api.planPartnerImageBatch(1, origin + "/list?page=3", "three", 3);
  assert.equal(result.nextPageUrl, null);
  assert.equal(last.calls.some(call => call[0] === "next-page"), false);
  const ended = fixture({ nextPageUrl: null });
  assert.equal((await ended.api.planPartnerImageBatch(1, origin + "/list", "three", 1)).nextPageUrl, null);
  assert.equal(ended.calls.filter(call => call[0] === "fetch").length, 1);
});

test("batch modes and page-number boundaries are validated before source reads or transport", async () => {
  for (const mode of ["list", "detail", "three", "unknown", null]) {
    for (const pageNumber of [0, -1, 1.5, 4, NaN, Infinity, "1", null]) {
      const { api, calls } = fixture();
      await assert.rejects(api.planPartnerImageBatch(1, origin + "/list", mode, pageNumber));
      assert.deepEqual(calls, []);
    }
  }
  for (const mode of ["detail", "list"]) {
    for (const pageNumber of [2, 3]) {
      const { api, calls } = fixture();
      await assert.rejects(api.planPartnerImageBatch(1, origin + "/list", mode, pageNumber));
      assert.deepEqual(calls, []);
    }
  }
  const invalid = fixture();
  await assert.rejects(invalid.api.planPartnerImageBatch(1, origin, "unknown", 1));
  assert.deepEqual(invalid.calls, []);
});

test("each continuation still rejects non-HTTPS or cross-source page inputs before transport", async () => {
  for (const pageNumber of [1, 2, 3]) {
    for (const url of ["https://other.example/list?page=2", "http://partner.example/list?page=2",
      "https://user:secret@partner.example/list", origin + ":444/list", origin + "/list#private"]) {
      const { api, calls } = fixture();
      await assert.rejects(api.planPartnerImageBatch(1, url, "three", pageNumber));
      assert.equal(calls.some(call => call[0] === "fetch" || call[0] === "download"), false);
    }
  }
});

test("the service rechecks template, redirected and next-page URLs without fetching an off-source page", async () => {
  const unsafe = ["https://other.example/list", "http://partner.example/list", origin + ":444/list",
    "https://user:secret@partner.example/list", origin + "/list#private"];
  for (const key of ["startUrl", "canonicalUrl", "nextPageUrl"]) {
    for (const url of unsafe) {
      const { api, calls } = fixture({ [key]: url });
      await assert.rejects(api.planPartnerImageBatch(1, origin + "/list", "three", 1));
      const fetches = calls.filter(call => call[0] === "fetch");
      assert.equal(fetches.length, key === "startUrl" ? 0 : 1);
      assert.ok(fetches.every(call => call[1] === origin + "/list"));
      assert.equal(calls.some(call => call[0] === "download"), false);
      if (key === "canonicalUrl") assert.equal(calls.some(call => call[0] === "list" || call[0] === "next-page"), false);
    }
  }
});

test("invalid inputs and modes fail before reading source config or transport", async () => {
  for (const [id, url, mode] of [
    [0, origin, "detail"], [1.5, origin, "list"], [1, origin, "unknown"],
    [1, "http://partner.example/post/1", "detail"], [1, origin + "/#private", "detail"],
    [1, "https://user:secret@partner.example/", "detail"], [1, origin + ":444/", "detail"],
    [1, "https://partner.example\\@localhost/", "detail"], [1, origin + "/\nprivate", "detail"],
  ]) {
    const { api, calls } = fixture();
    await assert.rejects(api.planPartnerImagePages(id, url, mode));
    assert.deepEqual(calls, []);
  }
});

test("unknown sources, mismatched origins and invalid stored config cannot fetch", async () => {
  for (const [options, url] of [
    [{ missing: true }, origin], [{}, "https://other.example/post/1"],
    [{ source: { origin: origin + "/path" } }, origin],
    [{ source: { rules: "invalid-json" } }, origin],
    [{ source: { imageOrigins: '["https://images.example/path"]' } }, origin],
    [{ source: { imageOrigins: '["https://user:secret@images.example"]' } }, origin],
    [{ source: { imageOrigins: JSON.stringify(Array(11).fill(imageOrigin)) } }, origin],
  ]) {
    const { api, calls } = fixture(options);
    await assert.rejects(api.collectPartnerPageImages(1, url));
    assert.equal(calls.some(call => call[0] === "fetch" || call[0] === "download"), false);
  }
});

test("photo extraction returns only JPEG bytes and hashes with same step abort signal", async () => {
  const { api, calls } = fixture();
  const photos = await api.collectPartnerPageImages(1, origin + "/post/1");
  assert.deepEqual(JSON.parse(JSON.stringify(photos)), [{ base64: "/9j/2Q==", hash: "synthetic-hash" }]);
  const fetch = calls.find(call => call[0] === "fetch");
  const download = calls.find(call => call[0] === "download");
  assert.equal(calls.find(call => call[0] === "photos")[2], origin + "/canonical");
  assert.deepEqual(Array.from(download[2]), [origin, imageOrigin]);
  assert.equal(fetch[3].signal, download[3].signal);
});

test("explicit photo hints bypass HTML and parsing but retain the JPEG downloader and 60 second step", async () => {
  const { api, calls } = fixture({ fetchError: new Error("HINTS_MUST_NOT_READ_HTML") });
  const hints = [origin + "/synthetic.jpg", "https://images.example:443/synthetic.jpg?size=large"];
  const photos = await api.collectPartnerPageImages(1, origin + "/post/1", hints);
  assert.deepEqual(JSON.parse(JSON.stringify(photos)), [{ base64: "/9j/2Q==", hash: "synthetic-hash" }]);
  assert.deepEqual(calls.map(call => call[0]), ["source", "rules", "timeout", "download"]);
  const download = calls.find(call => call[0] === "download");
  assert.deepEqual(Array.from(download[1]), [origin + "/synthetic.jpg", imageOrigin + "/synthetic.jpg?size=large"]);
  assert.deepEqual(Array.from(download[2]), [origin, imageOrigin]);
  assert.ok(download[3].signal instanceof AbortSignal);
  assert.deepEqual(calls.filter(call => call[0] === "timeout"), [["timeout", 60_000]]);
  assert.equal(calls.some(call => call[0] === "fetch" || call[0] === "photos"), false);
});

test("an explicit empty photo hint array is a fixed no-image error without HTML fallback", async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.collectPartnerPageImages(1, origin + "/post/1", []), error => {
    assert.equal(api.partnerImagesMessage(error), "没有找到可下载的帖子图片。");
    return true;
  });
  assert.equal(calls.some(call => ["fetch", "photos", "download"].includes(call[0])), false);
});

test("all photo hints are preflighted before the first download, including late invalid entries and sparse arrays", async () => {
  const invalidHints = [null, {}, "not-an-array", 1, Array(9).fill(imageOrigin + "/synthetic.jpg"),
    [1], [null], [{}], [imageOrigin + "/valid.jpg", false], [imageOrigin + "/valid.jpg", , imageOrigin + "/last.jpg"]];
  for (const hints of invalidHints) {
    const { api, calls } = fixture();
    await assert.rejects(api.collectPartnerPageImages(1, origin + "/post/1", hints), error => {
      assert.equal(api.partnerImagesMessage(error), "图片地址无效，请检查来源和图片域名。");
      return true;
    });
    assert.equal(calls.some(call => ["fetch", "photos", "download"].includes(call[0])), false);
  }
  const valid = fixture();
  const hints = Array.from({ length: 8 }, (_, index) => imageOrigin + "/synthetic-" + index + ".jpg");
  await valid.api.collectPartnerPageImages(1, origin + "/post/1", hints);
  assert.deepEqual(Array.from(valid.calls.find(call => call[0] === "download")[1]), hints);
});

test("hint URL validation rejects unsafe syntax, local paths and unconfigured hosts before any download", async () => {
  const invalid = ["", "relative.jpg", "/photo.jpg", "C:\\private\\photo.jpg", "file:///private.jpg", "data:image/png;base64,AAAA",
    "http://images.example/private.jpg", "https://user:secret@images.example/private.jpg", "https://@images.example/private.jpg",
    imageOrigin + ":444/private.jpg", imageOrigin + "/private.jpg#fragment", imageOrigin + "/private.jpg#",
    imageOrigin + "/private\n.jpg", "https://images.example\\@localhost/private.jpg", imageOrigin + "/".repeat(2048),
    "https://other.example/private.jpg", "https://images.example.other.example/private.jpg", "https://127.0.0.1/private.jpg",
    "https://[::1]/private.jpg", "https://localhost/private.jpg"];
  for (const url of invalid) {
    const { api, calls } = fixture();
    await assert.rejects(api.collectPartnerPageImages(1, origin + "/post/1", [imageOrigin + "/valid.jpg", url]), error => {
      assert.equal(api.partnerImagesMessage(error), "图片地址无效，请检查来源和图片域名。");
      assert.doesNotMatch(api.partnerImagesMessage(error), /private|images\.example|other\.example|localhost|secret/i);
      return true;
    });
    assert.equal(calls.some(call => ["fetch", "photos", "download"].includes(call[0])), false);
  }
  const unconfigured = fixture({ source: { imageOrigins: "[]" } });
  await assert.rejects(unconfigured.api.collectPartnerPageImages(1, origin + "/post/1", [imageOrigin + "/private.jpg"]));
  assert.equal(unconfigured.calls.some(call => call[0] === "download"), false);
});

test("undefined hints preserve the original HTML route and source validation always comes first", async () => {
  const original = fixture();
  await original.api.collectPartnerPageImages(1, origin + "/post/1", undefined);
  assert.deepEqual(original.calls.map(call => call[0]), ["source", "rules", "timeout", "fetch", "photos", "download"]);
  const hints = new Proxy([], { get() { throw new Error("HINTS_MUST_NOT_BE_ACCESSED"); } });
  const missing = fixture({ missing: true });
  await assert.rejects(missing.api.collectPartnerPageImages(1, origin + "/post/1", hints), /来源不存在/);
  assert.deepEqual(missing.calls.map(call => call[0]), ["source"]);
});

test("hint downloads retain safe error handling without returning image URLs or native exceptions", async () => {
  const { api, calls } = fixture({ downloadError: new Error(privateSentinel + " https://images.example/private.jpg") });
  await assert.rejects(api.collectPartnerPageImages(1, origin + "/post/1", [imageOrigin + "/synthetic.jpg"]), error => {
    assert.equal(api.partnerImagesMessage(error), "获取图片未完成，请检查网址、图片域名和网络后重试。");
    return true;
  });
  assert.equal(calls.filter(call => call[0] === "download").length, 1);
  assert.equal(calls.some(call => call[0] === "fetch" || call[0] === "photos"), false);
});

test("encoding and exception messages are fixed and never contain a response or native error", async () => {
  const { api } = fixture({ contentType: "text/html; charset=unsupported" });
  await assert.rejects(api.collectPartnerPageImages(1, origin), /页面编码/);
  assert.match(api.partnerImagesMessage({ code: "HTTP_STATUS", status: 403, message: privateSentinel }), /HTTP 403/);
  for (const error of [new Error(privateSentinel), { code: privateSentinel }, { code: "NO_PHOTOS" }, { code: "INVALID_IMAGE" }]) {
    assert.equal(api.partnerImagesMessage(error).includes(privateSentinel), false);
  }
});

test("pagination diagnostic failures use fixed safe messages without source URLs, HTML or native error text", async () => {
  const messages = new Set();
  for (const code of paginationCodes) {
    const error = Object.assign(new Error(privateSentinel), { code, url: "https://user:secret@private.example/" });
    const { api } = fixture({ nextError: error });
    await assert.rejects(api.planPartnerImageBatch(1, origin + "/list", "three", 1), caught => caught === error);
    const message = api.partnerImagesMessage(error);
    assert.equal(message, api.partnerImagesMessage({ code, message: "different-private-content" }));
    assert.notEqual(message, api.partnerImagesMessage({ code: "UNKNOWN_PAGINATION" }));
    assert.doesNotMatch(message, /SYNTHETIC_PRIVATE|private\.example|user:secret|different-private/);
    messages.add(message);
  }
  assert.equal(messages.size, 4);
});

test("both image actions authenticate before source reads and return only safe failures", async () => {
  for (const name of ["planPartnerImages", "fetchPartnerImages"]) {
    for (const authorized of [false, true]) {
      const calls = [];
      const operation = async () => { calls.push("operation"); throw new Error(privateSentinel); };
      const api = load("src/app/adminzhangzhang/partner-import/image-actions.ts", {
        "@/lib/auth": { requireAdmin: async () => { calls.push("auth"); if (!authorized) throw new Error("DENIED"); } },
        "@/lib/partner-images": { planPartnerImageBatch: operation, collectPartnerPageImages: operation,
          partnerImagesMessage: () => "SAFE_FAILURE" },
      });
      if (!authorized) {
        await assert.rejects(api[name](1, origin, "list"), /DENIED/);
        assert.deepEqual(calls, ["auth"]);
      } else {
        assert.equal((await api[name](1, origin, "list")).error, "SAFE_FAILURE");
        assert.deepEqual(calls, ["auth", "operation"]);
      }
    }
  }
});

test("photo-hint action authenticates before touching hints or source data and forwards the exact optional argument", async () => {
  let hintReads = 0;
  const hints = new Proxy([], { get() { hintReads += 1; throw new Error("HINT_READ"); } });
  const deniedService = fixture();
  const deniedCalls = [];
  const denied = load("src/app/adminzhangzhang/partner-import/image-actions.ts", {
    "@/lib/auth": { requireAdmin: async () => { deniedCalls.push("auth"); throw new Error("DENIED"); } },
    "@/lib/partner-images": { ...deniedService.api, partnerImagesMessage: () => "SAFE_FAILURE" },
  });
  await assert.rejects(denied.fetchPartnerImages(1, origin + "/post/1", hints), /DENIED/);
  assert.deepEqual(deniedCalls, ["auth"]);
  assert.deepEqual(deniedService.calls, []);
  assert.equal(hintReads, 0);
  for (const photoHints of [undefined, [], [imageOrigin + "/synthetic.jpg"], hints]) {
    const calls = [];
    const api = load("src/app/adminzhangzhang/partner-import/image-actions.ts", {
      "@/lib/auth": { requireAdmin: async () => { calls.push("auth"); } },
      "@/lib/partner-images": { collectPartnerPageImages: async (...args) => {
        assert.equal(calls[0], "auth");
        assert.equal(args[0], 1);
        assert.equal(args[1], origin + "/post/1");
        assert.equal(args[2], photoHints);
        calls.push("collect");
        return [{ base64: "/9j/2Q==", hash: "synthetic-hash" }];
      }, partnerImagesMessage: () => "SAFE_FAILURE" },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await api.fetchPartnerImages(1, origin + "/post/1", photoHints))), {
      photos: [{ base64: "/9j/2Q==", hash: "synthetic-hash" }],
    });
    assert.deepEqual(calls, ["auth", "collect"]);
  }
  assert.equal(hintReads, 0);
});

test("planning action forwards the selected mode and page number without making implicit follow-up requests", async () => {
  for (const [mode, suppliedPageNumber] of [["list", undefined], ["three", undefined],
    ["list", 1], ["detail", 1], ["three", 1], ["three", 2], ["three", 3]]) {
    const pageNumber = suppliedPageNumber ?? 1;
    const calls = [];
    const batch = { urls: [origin + "/post/1"], pageUrl: origin + "/list?page=" + pageNumber,
      nextPageUrl: mode === "three" && pageNumber < 3 ? origin + "/list?page=" + (pageNumber + 1) : null };
    const api = load("src/app/adminzhangzhang/partner-import/image-actions.ts", {
      "@/lib/auth": { requireAdmin: async () => { calls.push("auth"); } },
      "@/lib/partner-images": { planPartnerImageBatch: async (...args) => { calls.push(args); return batch; },
        collectPartnerPageImages: () => { throw new Error("PLANNING_MUST_NOT_DOWNLOAD_PHOTOS"); },
        partnerImagesMessage: () => "SAFE_FAILURE" },
    });
    const result = suppliedPageNumber === undefined
      ? await api.planPartnerImages(1, origin + "/list", mode)
      : await api.planPartnerImages(1, origin + "/list", mode, suppliedPageNumber);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), batch);
    assert.deepEqual(calls, ["auth", [1, origin + "/list", mode, pageNumber]]);
  }
});

test("ZIP local records and central directory contain exact JPEGs, lengths, CRC and offsets", () => {
  const { createPartnerImagesZip } = load("src/lib/partner-images-zip.ts");
  const files = [{ name: "page-001-photo-01.jpg", bytes: new TextEncoder().encode("hello") },
    { name: "page-002-photo-01.jpg", bytes: Uint8Array.from([255, 216, 255, 217]) }];
  const zip = createPartnerImagesZip(files);
  const data = new DataView(zip.buffer);
  let offset = 0;
  const offsets = [];
  for (const file of files) {
    offsets.push(offset);
    assert.equal(data.getUint32(offset, true), 0x04034b50);
    assert.equal(data.getUint16(offset + 8, true), 0);
    const length = data.getUint32(offset + 18, true), nameLength = data.getUint16(offset + 26, true);
    assert.equal(length, file.bytes.length);
    assert.equal(new TextDecoder().decode(zip.slice(offset + 30, offset + 30 + nameLength)), file.name);
    assert.deepEqual(zip.slice(offset + 30 + nameLength, offset + 30 + nameLength + length), file.bytes);
    offset += 30 + nameLength + length;
  }
  assert.equal(data.getUint32(14, true), 0x3610a686);
  const directoryOffset = offset;
  files.forEach((file, index) => {
    assert.equal(data.getUint32(offset, true), 0x02014b50);
    assert.equal(data.getUint32(offset + 42, true), offsets[index]);
    assert.equal(data.getUint32(offset + 16, true), data.getUint32(offsets[index] + 14, true));
    assert.equal(new TextDecoder().decode(zip.slice(offset + 46, offset + 46 + file.name.length)), file.name);
    offset += 46 + file.name.length;
  });
  assert.equal(data.getUint32(offset, true), 0x06054b50);
  assert.equal(data.getUint16(offset + 10, true), 2);
  assert.equal(data.getUint32(offset + 16, true), directoryOffset);
  assert.equal(data.getUint32(offset + 12, true), offset - directoryOffset);
  assert.equal(zip.length, offset + 22);
});

test("ZIP rejects arbitrary paths, duplicates and oversized archives", () => {
  const { createPartnerImagesZip } = load("src/lib/partner-images-zip.ts");
  const photo = { name: "page-001-photo-01.jpg", bytes: new Uint8Array(1) };
  for (const files of [[], [photo, photo], [{ ...photo, name: "../private.jpg" }],
    [{ ...photo, name: "page-001/photo-01.jpg" }], [{ ...photo, name: "page-001\\photo-01.jpg" }],
    [{ ...photo, name: "https://partner.example/private.jpg" }], Array(401).fill(photo),
    [{ ...photo, bytes: new Uint8Array(64 * 1024 * 1024 + 1) }]]) {
    assert.throws(() => createPartnerImagesZip(files));
  }
});
