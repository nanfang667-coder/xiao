export function isPromotionChannelCode(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(value);
}

function text(formData: FormData, key: string): string {
  if (!(formData instanceof FormData)) throw new Error("渠道信息无效");
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseHostname(value: string): string {
  const message = "请填写有效的短域名，例如 gp77.top，不要填写路径或参数";
  if (!value || value.length > 270 || value.startsWith("/") || /[\s\\?#]/.test(value)) {
    throw new Error(message);
  }
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new Error(message);
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !["https:", "http:"].includes(url.protocol) || url.username || url.password ||
    url.port || url.pathname !== "/" || url.search || url.hash ||
    hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
  ) {
    throw new Error(message);
  }
  return hostname;
}

export function parsePromotionChannelDetails(formData: FormData) {
  const name = text(formData, "name");
  if (!name || name.length > 80 || Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("渠道名称需要 1–80 个字符");
  }
  const hostname = parseHostname(text(formData, "hostname"));
  return { name, hostname };
}

export function parsePromotionChannelInput(formData: FormData) {
  const details = parsePromotionChannelDetails(formData);
  const code = text(formData, "code").toLowerCase();
  if (!isPromotionChannelCode(code)) {
    throw new Error("渠道标识需要 2–32 个字母、数字、短横线或下划线，并以字母或数字开头");
  }
  return { ...details, code };
}
