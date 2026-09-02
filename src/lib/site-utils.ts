export type SiteConfig = {
  id: string;
  hostname: string;
  name: string;
  singlePostPrice: number;
  membershipPrice: number;
  membershipOriginalPrice: number;
};

export const FALLBACK_SITE: SiteConfig = {
  id: "a",
  hostname: "fenglou1.com",
  name: "\u51e4\u697c",
  singlePostPrice: 10,
  membershipPrice: 38,
  membershipOriginalPrice: 58,
};

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(value: string | null | undefined): string | null {
  const first = value?.split(",", 1)[0]?.trim().toLowerCase();
  if (!first) return null;

  const withoutPort =
    first.startsWith("[") && first.includes("]")
      ? first.slice(1, first.indexOf("]"))
      : first.replace(/:\d+$/, "");
  if (withoutPort === "localhost" || withoutPort === "127.0.0.1") {
    return withoutPort;
  }
  return HOSTNAME_PATTERN.test(withoutPort) ? withoutPort : null;
}

export function siteOrigin(
  site: Pick<SiteConfig, "hostname">,
  nodeEnv = process.env.NODE_ENV,
): string {
  const local =
    site.hostname === "localhost" || site.hostname === "127.0.0.1";
  return `${nodeEnv === "production" || !local ? "https" : "http"}://${site.hostname}`;
}

export function isValidMoney(value: number): boolean {
  return Number.isFinite(value) && value >= 0.01 && value <= 100000;
}
