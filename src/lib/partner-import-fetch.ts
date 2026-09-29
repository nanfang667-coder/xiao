import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { STATUS_CODES, type ClientRequest, type IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const SAFE_ERROR = "合作方资源下载失败，请检查来源设置或稍后重试。";
const MAX_URL_LENGTH = 4096;
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTTP_STATUSES = new Set(Object.keys(STATUS_CODES).map(Number));
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export type PartnerFetchErrorCode = "INVALID_URL" | "ORIGIN_NOT_ALLOWED" | "UNSAFE_ADDRESS" | "DNS_FAILED"
  | "CONNECT_FAILED" | "TLS_FAILED" | "TIMEOUT" | "HTTP_STATUS" | "CONTENT_TYPE"
  | "UNSUPPORTED_ENCODING" | "TOO_LARGE" | "REDIRECT_LIMIT" | "INVALID_RESPONSE";

/** Carries only allowlisted diagnostic metadata, never source content or native errors. */
export class PartnerFetchError extends Error {
  readonly code: PartnerFetchErrorCode;
  readonly status?: number;

  constructor(code: PartnerFetchErrorCode, status?: number) {
    super(SAFE_ERROR);
    this.name = "PartnerFetchError";
    this.code = code;
    if (code === "HTTP_STATUS" && status !== undefined && HTTP_STATUSES.has(status)) this.status = status;
  }
}

type Address = { address: string; family: number };
type FetchOptions = { maxBytes?: number; accept?: "html" | "image" };
type Resource = { bytes: Buffer; contentType: string; url: string };
type TransportResult = { location: string } | { bytes: Buffer; contentType: string };
type Dependencies = {
  resolve: (hostname: string) => Promise<readonly Address[]>;
  request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  timeoutMs?: number;
};

function failed(code: PartnerFetchErrorCode = "INVALID_RESPONSE", status?: number): PartnerFetchError {
  return new PartnerFetchError(code, status);
}

function connectionFailure(error: unknown): PartnerFetchError {
  if (error instanceof PartnerFetchError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return failed("TIMEOUT");
  if (typeof code === "string" && (
    code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_") || [
      "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_SIGNATURE_FAILURE", "CERT_REVOKED", "EPROTO",
    ].includes(code)
  )) return failed("TLS_FAILED");
  return failed("CONNECT_FAILED");
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function inIpv4Range(address: number, base: string, bits: number): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(address / size) === Math.floor(ipv4Number(base) / size);
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return ![
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
      ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
    ].some(([base, bits]) => inIpv4Range(value, base as string, bits as number));
  }
  if (family !== 6 || address.includes("%") || address.includes(".")) return false;
  const [left, right = ""] = address.toLowerCase().split("::");
  const leading = left ? left.split(":") : [];
  const trailing = right ? right.split(":") : [];
  const words = [...leading, ...Array(8 - leading.length - trailing.length).fill("0"), ...trailing]
    .map((word) => parseInt(word, 16));
  // Only global unicast; exclude protocol assignments, documentation, old 6bone,
  // and 6to4. This also rejects mapped/translated IPv4, ULA, multicast and link-local.
  return (words[0] & 0xe000) === 0x2000
    && !(words[0] === 0x2001 && words[1] < 0x0200)
    && !(words[0] === 0x2001 && words[1] === 0x0db8)
    && words[0] !== 0x2002
    && words[0] !== 0x3ffe
    && words[0] !== 0x3fff;
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw failed("INVALID_URL");
  }
}

function parseAllowedUrl(raw: string, origins: ReadonlySet<string>): URL {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f#\\]/u.test(raw)) throw failed("INVALID_URL");
  const url = parseUrl(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw failed("INVALID_URL");
  // Reject even syntactically empty userinfo (https://@host/).
  if (raw.slice(raw.indexOf("://") + 3).split(/[/?]/u, 1)[0].includes("@")) throw failed("INVALID_URL");
  if (!origins.has(url.origin)) throw failed("ORIGIN_NOT_ALLOWED");
  return url;
}

async function resolveWhileActive(resolveAddresses: () => Promise<readonly Address[]>, signal: AbortSignal): Promise<readonly Address[]> {
  if (signal.aborted) throw failed("TIMEOUT");
  return new Promise((resolve, reject) => {
    const abort = () => reject(failed("TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(resolveAddresses)
      .then(resolve, (error: unknown) => reject(error instanceof PartnerFetchError ? error : failed("DNS_FAILED")))
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function download(
  url: URL,
  address: Address,
  dependencies: Dependencies,
  signal: AbortSignal,
  maxBytes: number,
  accept: "html" | "image",
): Promise<TransportResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    let outgoing: ClientRequest | undefined;
    let decoder: Transform | undefined;
    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = (error = failed()) => {
      if (settled) return;
      settled = true;
      cleanup();
      response?.unpipe();
      decoder?.destroy();
      response?.destroy();
      outgoing?.destroy();
      reject(error);
    };
    const succeed = (result: TransportResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const abort = () => fail(failed("TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    try {
      outgoing = dependencies.request(url, {
        method: "GET",
        agent: false,
        rejectUnauthorized: true,
        maxHeaderSize: 16 * 1024,
        // The validated DNS result is pinned to this socket. The hostname stays
        // on the URL for TLS certificate verification and the Host header.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: {
          Accept: accept === "html" ? "text/html, application/xhtml+xml" : "image/jpeg, image/png, image/webp, image/gif, image/avif",
          "Accept-Encoding": "gzip, deflate, br",
          "User-Agent": "PartnerPostImporter/1.0",
        },
      }, (incoming) => {
        response = incoming;
        incoming.on("error", () => fail());
        incoming.on("aborted", () => fail());
        if (settled || signal.aborted) {
          incoming.destroy();
          if (signal.aborted) abort();
          return;
        }
        try {
          const status = incoming.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            const location = incoming.headers.location;
            if (!location || location.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f#\\]/u.test(location)) return fail();
            succeed({ location });
            incoming.destroy();
            return;
          }
          if (status !== 200) return fail(failed("HTTP_STATUS", status));
          const contentType = incoming.headers["content-type"]?.trim() ?? "";
          const mimeType = contentType.split(";", 1)[0].trim().toLowerCase();
          const validType = accept === "html"
            ? mimeType === "text/html" || mimeType === "application/xhtml+xml"
            : IMAGE_TYPES.has(mimeType);
          if (!validType || contentType.length > 256 || /[^\x20-\x7e]/u.test(contentType)) return fail(failed("CONTENT_TYPE"));
          const encoding = incoming.headers["content-encoding"]?.trim().toLowerCase() || "identity";
          const declaredLength = incoming.headers["content-length"];
          if (declaredLength !== undefined && !/^\d+$/u.test(declaredLength)) return fail();
          if (declaredLength !== undefined && Number(declaredLength) > maxBytes) return fail(failed("TOO_LARGE"));
          if (encoding === "gzip") decoder = createGunzip();
          else if (encoding === "deflate") decoder = createInflate();
          else if (encoding === "br") decoder = createBrotliDecompress();
          else if (encoding !== "identity") return fail(failed("UNSUPPORTED_ENCODING"));

          const chunks: Buffer[] = [];
          let inputSize = 0;
          let outputSize = 0;
          let inputEnded = false;
          let outputEnded = false;
          const finish = () => {
            if (inputEnded && outputEnded) {
              if (outputSize === 0) return fail();
              succeed({ bytes: Buffer.concat(chunks, outputSize), contentType });
            }
          };
          const output = decoder ?? incoming;
          output.on("data", (chunk: Buffer) => {
            if (settled) return;
            outputSize += chunk.length;
            if (outputSize > maxBytes) return fail(failed("TOO_LARGE"));
            chunks.push(chunk);
          });
          output.on("end", () => {
            outputEnded = true;
            finish();
          });
          decoder?.on("error", () => fail());
          decoder?.on("close", () => {
            if (!outputEnded && !settled) fail();
          });
          incoming.on("data", (chunk: Buffer) => {
            if (settled) return;
            inputSize += chunk.length;
            if (inputSize > maxBytes) fail(failed("TOO_LARGE"));
          });
          incoming.on("end", () => {
            if (!incoming.complete || inputSize === 0
              || (declaredLength !== undefined && inputSize !== Number(declaredLength))) return fail();
            inputEnded = true;
            finish();
          });
          incoming.on("close", () => {
            // The HTTP stream can close normally while the decoder is still draining.
            if (!inputEnded && !settled) fail();
          });
          if (decoder) incoming.pipe(decoder);
        } catch {
          fail();
        }
      });
      outgoing.on("error", (error: unknown) => fail(connectionFailure(error)));
      outgoing.end();
    } catch (error) {
      fail(connectionFailure(error));
    }
  });
}

/** Dependency injection permits fully offline DNS/socket tests. Production uses the export below. */
export function createPartnerResourceFetcher(dependencies: Dependencies) {
  return async (rawUrl: string, allowedOrigins: string[], options: FetchOptions = {}): Promise<Resource> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 20_000);
    try {
      const accept = options.accept ?? "html";
      const maxBytes = options.maxBytes ?? (accept === "image" ? MAX_RESOURCE_BYTES : 2 * 1024 * 1024);
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_RESOURCE_BYTES
        || (accept !== "html" && accept !== "image")) throw failed("INVALID_RESPONSE");
      if (!allowedOrigins.length) throw failed("INVALID_URL");
      const origins = new Set(allowedOrigins.map((origin) => {
        const parsed = parseUrl(origin);
        if (origin !== parsed.origin || parsed.protocol !== "https:" || parsed.username || parsed.password) throw failed("INVALID_URL");
        return origin;
      }));
      let url = parseAllowedUrl(rawUrl, origins);
      for (let redirects = 0; redirects <= 3; redirects++) {
        const hostname = url.hostname.replace(/^\[|\]$/gu, "");
        const literalFamily = isIP(hostname);
        const addresses = literalFamily
          ? [{ address: hostname, family: literalFamily }]
          : await resolveWhileActive(() => dependencies.resolve(hostname), controller.signal);
        if (!addresses.length) throw failed("DNS_FAILED");
        if (addresses.length > 32
          || addresses.some((entry) => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) throw failed("UNSAFE_ADDRESS");
        const result = await download(url, addresses[0], dependencies, controller.signal, maxBytes, accept);
        if ("location" in result) {
          if (redirects === 3) throw failed("REDIRECT_LIMIT");
          let redirected: string;
          try {
            redirected = new URL(result.location, url).href;
          } catch {
            throw failed("INVALID_URL");
          }
          url = parseAllowedUrl(redirected, origins);
          continue;
        }
        return { ...result, url: url.href };
      }
      throw failed("REDIRECT_LIMIT");
    } catch (error) {
      throw error instanceof PartnerFetchError ? error : failed();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

export const fetchPartnerResource = createPartnerResourceFetcher({
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request,
});
