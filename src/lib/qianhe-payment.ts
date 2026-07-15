import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { PayMethodKey } from "@/lib/membership";

const QIANHE_API_ORIGIN = "https://qianhe.jkosiuwn.xyz";
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;
type SignableValue = string | number | boolean | null | undefined;

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "configuration"
      | "unavailable"
      | "rejected"
      | "invalid_response" = "invalid_response",
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PaymentProviderError(
      `Missing payment configuration: ${name}`,
      "configuration",
    );
  }
  return value;
}

function merchantConfig() {
  return {
    mchId: requiredEnv("QIANHE_MCH_ID"),
    key: requiredEnv("QIANHE_MCH_KEY"),
  };
}

function wayCode(payMethod: PayMethodKey): string {
  const environmentNames: Record<PayMethodKey, string> = {
    alipay: "QIANHE_ALIPAY_WAY_CODE",
  };
  return requiredEnv(environmentNames[payMethod]);
}

export function assertQianheConfiguration(payMethod: PayMethodKey): void {
  merchantConfig();
  wayCode(payMethod);
  paymentSiteOrigin();
}

export function paymentSiteOrigin(): string {
  const configured = process.env.PAYMENT_SITE_URL?.trim() || "https://gp77.top";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new PaymentProviderError("Invalid PAYMENT_SITE_URL", "configuration");
  }

  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new PaymentProviderError("PAYMENT_SITE_URL must use HTTPS", "configuration");
  }
  if (url.username || url.password) {
    throw new PaymentProviderError(
      "PAYMENT_SITE_URL must not contain credentials",
      "configuration",
    );
  }
  return url.origin;
}

function signableEntries(params: JsonRecord): [string, string][] {
  return Object.entries(params)
    .filter(([key, value]) => key !== "sign" && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new PaymentProviderError(`Unsupported signed field: ${key}`);
      }
      return [key, String(value as SignableValue)] as [string, string];
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

export function createQianheSignature(params: JsonRecord, key: string): string {
  const plaintext = [
    ...signableEntries(params).map(([name, value]) => `${name}=${value}`),
    `key=${key}`,
  ].join("&");
  return createHash("md5").update(plaintext, "utf8").digest("hex");
}

function signatureMatches(params: JsonRecord, signature: unknown, key: string): boolean {
  if (typeof signature !== "string" || !/^[a-fA-F0-9]{32}$/.test(signature)) return false;
  const expected = createQianheSignature(params, key);
  return timingSafeEqual(
    Buffer.from(expected, "ascii"),
    Buffer.from(signature.toLowerCase(), "ascii"),
  );
}

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentProviderError(`Invalid ${field}`);
  }
  return value as JsonRecord;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PaymentProviderError(`Invalid ${field}`);
  }
  return value;
}

function boundedString(value: unknown, field: string, maxLength = 255): string {
  const parsed = nonEmptyString(value, field);
  if (parsed.length > maxLength) throw new PaymentProviderError(`Invalid ${field}`);
  return parsed;
}

function safeInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PaymentProviderError(`Invalid ${field}`);
  }
  return parsed;
}

function timestamp(value: unknown, field: string): Date {
  const milliseconds = safeInteger(value, field);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new PaymentProviderError(`Invalid ${field}`);
  return date;
}

function securePaymentUrl(value: unknown): string {
  const raw = boundedString(value, "payUrl", 4096);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PaymentProviderError("Invalid payUrl");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PaymentProviderError("Unsafe payUrl");
  }
  return url.toString();
}

async function postJson(path: string, body: JsonRecord): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(new URL(path, QIANHE_API_ORIGIN), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PaymentProviderError("Payment provider is unavailable", "unavailable");
  }

  if (!response.ok) {
    throw new PaymentProviderError("Payment provider request failed", "unavailable");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new PaymentProviderError("Payment provider response is too large");
  }
  try {
    return record(JSON.parse(text), "provider response");
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("Payment provider returned invalid JSON");
  }
}

function verifiedResponseData(payload: JsonRecord, key: string): JsonRecord {
  if (safeInteger(payload.code, "code") !== 0) {
    throw new PaymentProviderError("Payment provider rejected the request", "rejected");
  }
  const data = record(payload.data, "response data");
  if (!signatureMatches(data, payload.sign, key)) {
    throw new PaymentProviderError("Invalid payment provider signature");
  }
  return data;
}

export type CreateQianheOrderInput = {
  payMethod: PayMethodKey;
  merchantOrderNo: string;
  subject: string;
  amountCents: number;
  clientIp: string;
  notifyUrl: string;
  returnUrl: string;
};

export type CreatedQianheOrder = {
  tradeNo: string;
  paymentUrl: string;
  expiresAt: Date;
};

export async function createQianheOrder(
  input: CreateQianheOrderInput,
): Promise<CreatedQianheOrder> {
  const config = merchantConfig();
  const request: JsonRecord = {
    mchId: config.mchId,
    wayCode: wayCode(input.payMethod),
    subject: input.subject,
    outTradeNo: input.merchantOrderNo,
    amount: input.amountCents,
    clientIp: input.clientIp,
    notifyUrl: input.notifyUrl,
    returnUrl: input.returnUrl,
    reqTime: Date.now(),
  };
  request.sign = createQianheSignature(request, config.key);

  const payload = await postJson("/api/createorder", request);
  const data = verifiedResponseData(payload, config.key);
  if (nonEmptyString(data.mchId, "mchId") !== config.mchId) {
    throw new PaymentProviderError("Payment merchant mismatch");
  }
  if (nonEmptyString(data.outTradeNo, "outTradeNo") !== input.merchantOrderNo) {
    throw new PaymentProviderError("Payment order mismatch");
  }
  if (safeInteger(data.amount, "amount") !== input.amountCents) {
    throw new PaymentProviderError("Payment amount mismatch");
  }

  return {
    tradeNo: boundedString(data.tradeNo, "tradeNo"),
    paymentUrl: securePaymentUrl(data.payUrl),
    expiresAt: timestamp(data.expiredTime, "expiredTime"),
  };
}

export type QueriedQianheOrder = {
  tradeNo: string;
  state: number;
  paidAt?: Date;
};

export async function queryQianheOrder(
  merchantOrderNo: string,
  expectedAmountCents: number,
): Promise<QueriedQianheOrder> {
  const config = merchantConfig();
  const request: JsonRecord = {
    mchId: config.mchId,
    outTradeNo: merchantOrderNo,
    reqTime: Date.now(),
  };
  request.sign = createQianheSignature(request, config.key);

  const payload = await postJson("/api/queryorder", request);
  const data = verifiedResponseData(payload, config.key);
  if (nonEmptyString(data.mchId, "mchId") !== config.mchId) {
    throw new PaymentProviderError("Payment merchant mismatch");
  }
  if (nonEmptyString(data.outTradeNo, "outTradeNo") !== merchantOrderNo) {
    throw new PaymentProviderError("Payment order mismatch");
  }
  if (safeInteger(data.amount, "amount") !== expectedAmountCents) {
    throw new PaymentProviderError("Payment amount mismatch");
  }

  const successTime = data.successTime;
  return {
    tradeNo: boundedString(data.tradeNo, "tradeNo"),
    state: safeInteger(data.state, "state"),
    ...(successTime !== null && successTime !== undefined && successTime !== ""
      ? { paidAt: timestamp(successTime, "successTime") }
      : {}),
  };
}

export type QianheNotification = {
  merchantOrderNo: string;
  tradeNo: string;
  amountCents: number;
  state: number;
  notifiedAt: Date;
};

export function verifyQianheNotification(payload: unknown): QianheNotification {
  const notification = record(payload, "notification");
  const config = merchantConfig();
  if (!signatureMatches(notification, notification.sign, config.key)) {
    throw new PaymentProviderError("Invalid payment notification signature");
  }
  if (nonEmptyString(notification.mchId, "mchId") !== config.mchId) {
    throw new PaymentProviderError("Payment merchant mismatch");
  }

  return {
    merchantOrderNo: boundedString(notification.outTradeNo, "outTradeNo"),
    tradeNo: boundedString(notification.tradeNo, "tradeNo"),
    amountCents: safeInteger(notification.amount, "amount"),
    state: safeInteger(notification.state, "state"),
    notifiedAt: timestamp(notification.notifyTime, "notifyTime"),
  };
}
