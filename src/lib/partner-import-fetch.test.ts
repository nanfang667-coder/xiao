import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, IncomingHttpHeaders } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import test from "node:test";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { createPartnerResourceFetcher, PartnerFetchError, type PartnerFetchErrorCode } from "./partner-import-fetch.ts";

const ORIGIN = "https://partner.example";
const compressors = [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]] as const;
const SAFE_ERROR = "合作方资源下载失败，请检查来源设置或稍后重试。";
type Address = { address: string; family: number };
type Reply = {
  status?: number;
  headers?: IncomingHttpHeaders;
  chunks?: Buffer[];
  incomplete?: boolean;
  stall?: boolean;
  error?: boolean;
  errorCode?: string;
  afterInputEnd?: () => void;
};
type Dependencies = Parameters<typeof createPartnerResourceFetcher>[0];

function fixture(replies: Reply[] = [{}], settings: {
  addresses?: Address[];
  resolve?: Dependencies["resolve"];
  timeoutMs?: number;
} = {}) {
  const calls: { url: URL; options: RequestOptions; destroyed: boolean; incoming?: IncomingMessage }[] = [];
  let dnsCalls = 0;
  const fetchResource = createPartnerResourceFetcher({
    timeoutMs: settings.timeoutMs ?? 2000,
    resolve: async (hostname) => {
      dnsCalls++;
      if (settings.resolve) return settings.resolve(hostname);
      return settings.addresses ?? [{ address: "93.184.215.14", family: 4 }];
    },
    request: (url, options, callback) => {
      const index = calls.length;
      const call: typeof calls[number] = { url, options, destroyed: false };
      calls.push(call);
      const outgoing = new EventEmitter() as ClientRequest;
      outgoing.destroy = () => {
        call.destroyed = true;
        return outgoing;
      };
      outgoing.end = (() => {
        queueMicrotask(() => {
          const reply = replies[index] ?? {};
          if (reply.error) {
            outgoing.emit("error", Object.assign(new Error("PRIVATE source URL and post contents"), { code: reply.errorCode }));
            return;
          }
          const stream = new PassThrough();
          const incoming = Object.assign(stream, {
            statusCode: reply.status ?? 200,
            headers: reply.headers ?? { "content-type": "text/html; charset=utf-8" },
            complete: !reply.incomplete,
          }) as unknown as IncomingMessage;
          call.incoming = incoming;
          callback(incoming);
          if (reply.afterInputEnd) incoming.once("end", reply.afterInputEnd);
          if (reply.stall || call.destroyed || incoming.destroyed) return;
          for (const chunk of reply.chunks ?? [Buffer.from("<p>Fictional post</p>")]) stream.write(chunk);
          stream.end();
        });
        return outgoing;
      }) as ClientRequest["end"];
      return outgoing;
    },
  });
  return { fetchResource, calls, dnsCalls: () => dnsCalls };
}

async function assertSafeFailure(promise: Promise<unknown>, code?: PartnerFetchErrorCode) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PartnerFetchError);
    if (code) assert.equal(error.code, code);
    assert.equal(JSON.stringify(error).includes("PRIVATE"), false);
    assert.equal(String(error.stack).includes("PRIVATE"), false);
    assert.equal(error.message, SAFE_ERROR);
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("downloads an allowlisted HTML resource with TLS verification and a pinned DNS result", async () => {
  const f = fixture();
  const result = await f.fetchResource(ORIGIN + "/posts?page=2", [ORIGIN]);
  assert.equal(result.url, ORIGIN + "/posts?page=2");
  assert.equal(result.contentType, "text/html; charset=utf-8");
  assert.equal(result.bytes.toString(), "<p>Fictional post</p>");
  assert.equal(f.dnsCalls(), 1);
  const options = f.calls[0].options;
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.method, "GET");
  assert.equal((options.headers as Record<string, string>)["Accept-Encoding"], "gzip, deflate, br");
  assert.equal((options.headers as Record<string, string>).Cookie, undefined);
  const all = await new Promise<unknown>((resolve, reject) => {
    options.lookup!("partner.example", { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
  assert.deepEqual(all, [{ address: "93.184.215.14", family: 4 }]);
  assert.equal(f.dnsCalls(), 1, "socket lookup never performs a second DNS resolution");
});

test("rejects unapproved origins, credentials, fragments and non-HTTPS URLs before DNS", async () => {
  for (const url of [
    "http://partner.example/posts", "https://other.example/posts",
    "https://partner.example.evil.example/posts", "https://partner.example:8443/posts",
    "https://u:p@partner.example/posts", "https://@partner.example/posts",
    ORIGIN + "/posts#secret", ORIGIN + "/posts#", ORIGIN + "/a\nb",
    " https://partner.example/posts", "https:\\\\partner.example\\posts",
  ]) {
    const f = fixture();
    await assertSafeFailure(f.fetchResource(url, [ORIGIN]));
    assert.equal(f.dnsCalls(), 0);
    assert.equal(f.calls.length, 0);
  }
});

test("rejects malformed origin configuration and unsafe byte limits", async () => {
  for (const origins of [[], [ORIGIN + "/"], ["http://partner.example"], [ORIGIN + "/posts"]]) {
    await assertSafeFailure(fixture().fetchResource(ORIGIN + "/posts", origins));
  }
  for (const maxBytes of [0, -1, 1.5, Infinity, 10 * 1024 * 1024 + 1]) {
    await assertSafeFailure(fixture().fetchResource(ORIGIN + "/posts", [ORIGIN], { maxBytes }));
  }
});

test("rejects non-public IPv4 and IPv6 addresses including mapped and transition ranges", async () => {
  const blocked = [
    "0.0.0.0", "10.2.3.4", "100.64.2.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.9", "192.0.2.1", "192.88.99.1",
    "192.168.2.1", "198.18.0.1", "198.19.255.255", "198.51.100.1",
    "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1",
    "fc00::1", "fdff::1", "fe80::1", "ff02::1", "2001::1",
    "2001:db8::1", "2002:7f00:1::1", "3ffe::1", "3fff::1",
  ];
  for (const address of blocked) {
    const f = fixture([{}], { addresses: [{ address, family: address.includes(":") ? 6 : 4 }] });
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]));
    assert.equal(f.calls.length, 0, address);
  }
});

test("rejects mixed public/private DNS answers and invalid address families", async () => {
  for (const addresses of [
    [{ address: "93.184.215.14", family: 4 }, { address: "127.0.0.1", family: 4 }],
    [{ address: "93.184.215.14", family: 6 }],
    [{ address: "not-an-ip", family: 4 }],
    [],
  ]) {
    const f = fixture([{}], { addresses });
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]));
    assert.equal(f.calls.length, 0);
  }
});

test("accepts public IPv6 and pins it; literal private URLs never reach transport", async () => {
  const f = fixture([{}], { addresses: [{ address: "2606:4700:4700::1111", family: 6 }] });
  assert.equal((await f.fetchResource(ORIGIN, [ORIGIN])).contentType, "text/html; charset=utf-8");
  for (const origin of ["https://127.0.0.1", "https://[::1]", "https://[::ffff:7f00:1]"]) {
    const literal = fixture();
    await assertSafeFailure(literal.fetchResource(origin, [origin]));
    assert.equal(literal.calls.length, 0);
    assert.equal(literal.dnsCalls(), 0);
  }
});

test("follows relative redirects within the allowlist and revalidates DNS on every hop", async () => {
  const f = fixture([
    { status: 302, headers: { location: "/second" } },
    { status: 307, headers: { location: ORIGIN + "/third" } },
    {},
  ]);
  const result = await f.fetchResource(ORIGIN + "/first", [ORIGIN]);
  assert.equal(result.url, ORIGIN + "/third");
  assert.equal(f.calls.length, 3);
  assert.equal(f.dnsCalls(), 3);
});

test("redirects cannot leave the allowlist, downgrade TLS, add credentials or target private IPs", async () => {
  for (const location of [
    "https://other.example/private", "http://partner.example/private",
    "https://user:password@partner.example/private", "https://127.0.0.1/private",
    "/next#fragment", "/next\nheader",
  ]) {
    const f = fixture([{ status: 302, headers: { location } }]);
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]));
    assert.equal(f.calls.length, 1);
  }
  let resolutions = 0;
  const rebinding = fixture([{ status: 302, headers: { location: "/next" } }], {
    resolve: async () => [{ address: ++resolutions === 1 ? "93.184.215.14" : "127.0.0.1", family: 4 }],
  });
  await assertSafeFailure(rebinding.fetchResource(ORIGIN, [ORIGIN]));
  assert.equal(rebinding.calls.length, 1);
});

test("permits at most three redirects", async () => {
  const redirect = { status: 302, headers: { location: "/next" } };
  const valid = fixture([redirect, redirect, redirect, {}]);
  await valid.fetchResource(ORIGIN, [ORIGIN]);
  assert.equal(valid.calls.length, 4);
  const excessive = fixture([redirect, redirect, redirect, redirect, {}]);
  await assertSafeFailure(excessive.fetchResource(ORIGIN, [ORIGIN]));
  assert.equal(excessive.calls.length, 4);
});

test("rejects statuses, content types, invalid compression and excessive declared/streamed lengths", async () => {
  const replies: Reply[] = [
    { status: 401 }, { status: 204 }, { status: 500 }, { status: 302, headers: {} },
    { headers: { "content-type": "application/json" } },
    { headers: { "content-type": "text/html", "content-encoding": "gzip" } },
    { headers: { "content-type": "text/html", "content-length": "1000" } },
    { headers: { "content-type": "text/html", "content-length": "NaN" } },
    { headers: { "content-type": "text/html", "content-length": "1" } },
    { chunks: [Buffer.alloc(8), Buffer.alloc(8)] },
    { incomplete: true, chunks: [Buffer.from("abc")] },
    { chunks: [] },
  ];
  for (const reply of replies) {
    const f = fixture([reply]);
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN], { maxBytes: 10 }));
    assert.equal(f.calls[0].destroyed, true);
  }
});

test("accepts bounded raster images but never SVG or HTML as images", async () => {
  const f = fixture([{ headers: { "content-type": "image/png" }, chunks: [Buffer.from([137, 80, 78, 71])] }]);
  assert.equal((await f.fetchResource(ORIGIN, [ORIGIN], { accept: "image" })).contentType, "image/png");
  for (const contentType of ["image/svg+xml", "text/html", "application/octet-stream"]) {
    const invalid = fixture([{ headers: { "content-type": contentType } }]);
    await assertSafeFailure(invalid.fetchResource(ORIGIN, [ORIGIN], { accept: "image" }));
  }
});

test("end-to-end deadline covers stalled DNS and stalled response bodies", async () => {
  const dns = fixture([], { timeoutMs: 20, resolve: () => new Promise(() => {}) });
  await assertSafeFailure(dns.fetchResource(ORIGIN, [ORIGIN]));
  assert.equal(dns.calls.length, 0);
  const response = fixture([{ stall: true }], { timeoutMs: 20 });
  await assertSafeFailure(response.fetchResource(ORIGIN, [ORIGIN]), "TIMEOUT");
  assert.equal(response.calls[0].destroyed, true);
});

test("redacts original DNS and request errors", async () => {
  const dns = fixture([], { resolve: async () => { throw new Error("PRIVATE data and credentials"); } });
  await assertSafeFailure(dns.fetchResource(ORIGIN, [ORIGIN]));
  await assertSafeFailure(fixture([{ error: true }]).fetchResource(ORIGIN, [ORIGIN]));
});

test("retains a bounded charset header for correct non-UTF-8 HTML decoding", async () => {
  const f = fixture([{ headers: { "content-type": "text/html; charset=GBK" }, chunks: [Buffer.from([0xd6, 0xd0, 0xce, 0xc4])] }]);
  const result = await f.fetchResource(ORIGIN, [ORIGIN]);
  assert.equal(result.contentType, "text/html; charset=GBK");
  assert.equal(new TextDecoder("GBK", { fatal: true }).decode(result.bytes), "中文");
  const longHeader = fixture([{ headers: { "content-type": "text/html; x=" + "a".repeat(256) } }]);
  await assertSafeFailure(longHeader.fetchResource(ORIGIN, [ORIGIN]));
});
test("classifies failures without retaining URLs, credentials, bodies or native errors", async () => {
  const cases: { code: PartnerFetchErrorCode; pending: Promise<unknown> }[] = [
    { code: "INVALID_URL", pending: fixture().fetchResource("PRIVATE invalid URL", [ORIGIN]) },
    { code: "ORIGIN_NOT_ALLOWED", pending: fixture().fetchResource("https://other.example/PRIVATE", [ORIGIN]) },
    { code: "DNS_FAILED", pending: fixture([], { resolve: async () => { throw new Error("PRIVATE credentials"); } }).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "UNSAFE_ADDRESS", pending: fixture([], { addresses: [{ address: "127.0.0.1", family: 4 }] }).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "CONNECT_FAILED", pending: fixture([{ error: true, errorCode: "ECONNREFUSED" }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "TLS_FAILED", pending: fixture([{ error: true, errorCode: "CERT_HAS_EXPIRED" }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "TLS_FAILED", pending: fixture([{ error: true, errorCode: "ERR_TLS_CERT_ALTNAME_INVALID" }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "TIMEOUT", pending: fixture([{ error: true, errorCode: "ETIMEDOUT" }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "CONTENT_TYPE", pending: fixture([{ headers: { "content-type": "PRIVATE" } }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "UNSUPPORTED_ENCODING", pending: fixture([{ headers: { "content-type": "text/html", "content-encoding": "PRIVATE" } }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "TOO_LARGE", pending: fixture([{ chunks: [Buffer.alloc(32)] }]).fetchResource(ORIGIN, [ORIGIN], { maxBytes: 8 }) },
    { code: "INVALID_RESPONSE", pending: fixture([{ incomplete: true }]).fetchResource(ORIGIN, [ORIGIN]) },
    { code: "REDIRECT_LIMIT", pending: fixture(Array(4).fill({ status: 302, headers: { location: "/PRIVATE" } })).fetchResource(ORIGIN, [ORIGIN]) },
  ];
  await Promise.all(cases.map(({ pending, code }) => assertSafeFailure(pending, code)));
});

test("only exposes allowlisted numeric HTTP statuses", async () => {
  for (const status of [403, 404, 429, 500, 503, 999, -1, 200.5]) {
    await assert.rejects(fixture([{ status }]).fetchResource(ORIGIN, [ORIGIN]), (error: unknown) => {
      assert.ok(error instanceof PartnerFetchError);
      assert.equal(error.code, "HTTP_STATUS");
      assert.equal(error.status, [403, 404, 429, 500, 503].includes(status) ? status : undefined);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("streams gzip, deflate and Brotli responses with compressed Content-Length", async () => {
  const body = Buffer.from("<article>" + "Fictional post. ".repeat(100) + "</article>");
  for (const [encoding, encode] of compressors) {
    const compressed = encode(body);
    const f = fixture([{
      headers: { "content-type": "text/html; charset=utf-8", "content-encoding": encoding, "content-length": String(compressed.length) },
      chunks: [compressed.subarray(0, 5), compressed.subarray(5)],
    }]);
    const result = await f.fetchResource(ORIGIN, [ORIGIN], { maxBytes: body.length });
    assert.deepEqual(result.bytes, body);
    assert.equal(result.contentType, "text/html; charset=utf-8");
  }
});

test("compression applies to supported image resources too", async () => {
  const body = Buffer.from([137, 80, 78, 71]);
  const f = fixture([{
    headers: { "content-type": "image/png", "content-encoding": "gzip" },
    chunks: [gzipSync(body)],
  }]);
  const result = await f.fetchResource(ORIGIN, [ORIGIN], { accept: "image" });
  assert.deepEqual(result.bytes, body);
});

test("rejects unsupported and stacked encodings without exposing header values", async () => {
  for (const encoding of ["compress", "gzip, br", "PRIVATE token"]) {
    const f = fixture([{ headers: { "content-type": "text/html", "content-encoding": encoding } }]);
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]), "UNSUPPORTED_ENCODING");
    assert.equal(f.calls[0].destroyed, true);
  }
});

test("bounds both compressed input and decompressed output", async () => {
  for (const [encoding, encode] of compressors) {
    const bomb = encode(Buffer.alloc(2 * 1024 * 1024, 65));
    const expanded = fixture([{
      headers: { "content-type": "text/html", "content-encoding": encoding },
      chunks: [bomb],
    }]);
    await assertSafeFailure(expanded.fetchResource(ORIGIN, [ORIGIN], { maxBytes: 4096 }), "TOO_LARGE");
    assert.equal(expanded.calls[0].destroyed, true);
    assert.equal(expanded.calls[0].incoming?.destroyed, true);

    const compressed = encode(Buffer.from("Small body."));
    for (const headers of [
      { "content-type": "text/html", "content-encoding": encoding },
      { "content-type": "text/html", "content-encoding": encoding, "content-length": String(compressed.length) },
    ]) {
      const wire = fixture([{ headers, chunks: [compressed] }]);
      await assertSafeFailure(wire.fetchResource(ORIGIN, [ORIGIN], { maxBytes: compressed.length - 1 }), "TOO_LARGE");
      assert.equal(wire.calls[0].destroyed, true);
    }
  }
});

test("rejects corrupt, truncated and empty compressed streams without original zlib errors", async () => {
  for (const [encoding, encode] of compressors) {
    const valid = encode(Buffer.from("Fictional post."));
    for (const chunks of [
      [Buffer.from("PRIVATE malformed compressed bytes")],
      [valid.subarray(0, valid.length - 2)],
      [encode(Buffer.alloc(0))],
    ]) {
      const f = fixture([{ headers: { "content-type": "text/html", "content-encoding": encoding }, chunks }]);
      await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]), "INVALID_RESPONSE");
      assert.equal(f.calls[0].destroyed, true);
      assert.equal(f.calls[0].incoming?.destroyed, true);
    }
  }
});

test("validates compressed response completeness and declared wire length", async () => {
  const compressed = gzipSync(Buffer.from("Fictional post."));
  for (const reply of [
    { incomplete: true },
    { headers: { "content-type": "text/html", "content-encoding": "gzip", "content-length": String(compressed.length + 1) } },
  ]) {
    const f = fixture([{ headers: { "content-type": "text/html", "content-encoding": "gzip" }, chunks: [compressed], ...reply }]);
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]), "INVALID_RESPONSE");
    assert.equal(f.calls[0].destroyed, true);
  }
});

test("deadline remains active after the compressed HTTP body ends, until decoding completes", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [encoding, encode] of compressors) {
    let reachedInputEnd = false;
    const f = fixture([{
      headers: { "content-type": "text/html", "content-encoding": encoding },
      chunks: [encode(Buffer.alloc(256 * 1024, 65))],
      afterInputEnd: () => {
        reachedInputEnd = true;
        // zlib output callbacks run after this microtask, so this advances the
        // deadline specifically while decoding remains unfinished.
        queueMicrotask(() => context.mock.timers.tick(2000));
      },
    }]);
    await assertSafeFailure(f.fetchResource(ORIGIN, [ORIGIN]), "TIMEOUT");
    assert.equal(reachedInputEnd, true);
    assert.equal(f.calls[0].destroyed, true);
    assert.equal(f.calls[0].incoming?.destroyed, true);
  }
});
