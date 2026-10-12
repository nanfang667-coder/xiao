// Shared by server actions and client UI. Keep this module free of server imports,
// source content, URLs, and raw exception messages.
const ERROR_MESSAGES = {
  INVALID_URL: "网址无效，请输入完整的 HTTPS 列表页网址。",
  ORIGIN_NOT_ALLOWED: "网址或跳转地址不在允许的来源内，请检查来源设置，并请合作方确认正确的网址。",
  UNSAFE_ADDRESS: "来源域名解析到了受保护的网络地址，已停止下载。请检查 DNS 或代理配置，保留网络地址安全检查。",
  DNS_FAILED: "无法解析来源域名，请检查域名、DNS 和服务器网络连接。",
  CONNECT_FAILED: "无法连接合作方网站，请检查服务器网络或代理配置，稍后重试。",
  TLS_FAILED: "合作方网站的 HTTPS 安全连接失败，请合作方检查证书和 TLS 配置，并保留证书验证。",
  TIMEOUT: "连接或下载超时，请检查服务器网络及合作方网站状态，稍后重试。",
  HTTP_STATUS: "合作方未返回可读取的页面，请检查网址及访问权限。",
  CONTENT_TYPE: "合作方返回的资源类型与请求不符，请检查页面或图片网址及其响应类型。",
  UNSUPPORTED_ENCODING: "合作方返回了暂不支持的压缩格式，请合作方提供不压缩的响应，或调整下载器的格式支持。",
  TOO_LARGE: "页面或图片超过下载大小限制，请缩小导入范围或请合作方提供较小的资源。",
  REDIRECT_LIMIT: "合作方网站跳转次数过多，请确认最终可直接访问的网址。",
  INVALID_RESPONSE: "合作方返回的响应不完整或格式无效，请稍后重试；如持续失败，请合作方检查响应格式。",
  INVALID_RULES: "采集规则无效，请检查高级配置中的 CSS 选择器和字段设置。",
  HTML_ENCODING: "页面文字编码无法识别，请合作方确认页面编码，或调整导入器的编码支持。",
  LISTING_NO_MATCH: "列表页已读取，但帖子链接规则未匹配到元素。请调整来源的帖子链接选择器；若内容需要登录或脚本加载，请合作方提供可直接读取的页面或接口。",
  LISTING_NO_SAFE_LINKS: "帖子链接规则已匹配元素，但没有符合导入要求的详情链接。请选择直接带有 href 的同站帖子链接，避开翻页、导航和广告链接。",
  TOO_MANY_POSTS: "此页匹配的帖子超过 50 条，请缩小帖子链接选择器的范围或使用每页不超过 50 条的列表。",
  DETAIL_MISSING_FIELDS: "已读取帖子详情，但未找到标题或正文。请检查标题、正文的字段选择器，并确认页面无需登录或脚本加载。",
  DETAIL_AMBIGUOUS_FIELDS: "字段选择器匹配了多个区域，请缩小到单个字段容器后重试。",
  DETAIL_LIMIT: "帖子字段或图片数量超过导入限制，请检查字段及图片选择器，缩小采集范围。",
  IMPORT_FAILED: "导入未完成，请检查来源设置和采集规则后重试。",
} as const;

export type PartnerImportDiagnosticCode = keyof typeof ERROR_MESSAGES;

export function isPartnerImportDiagnosticCode(value: unknown): value is PartnerImportDiagnosticCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MESSAGES, value);
}

/** Only allowlisted codes and a validated numeric HTTP status can reach the UI. */
export function getPartnerImportErrorMessage(code: unknown, status?: unknown): string {
  if (!isPartnerImportDiagnosticCode(code)) return ERROR_MESSAGES.IMPORT_FAILED;
  if (code === "HTTP_STATUS" && typeof status === "number"
    && Number.isInteger(status) && status >= 100 && status <= 599) {
    if (status === 401 || status === 403) {
      return `合作方返回 HTTP ${status}，当前导入请求没有访问权限。请合作方授权服务器访问或提供导出接口。`;
    }
    if (status === 404) return "合作方返回 HTTP 404，页面不存在，请检查网址。";
    if (status === 429) return "合作方返回 HTTP 429，请求过于频繁，请稍后重试并与合作方确认访问频率。";
    if (status >= 500) return `合作方返回 HTTP ${status}，网站暂时无法处理请求，请稍后重试。`;
    return `合作方返回 HTTP ${status}，未返回可读取的页面，请检查网址及访问权限。`;
  }
  return ERROR_MESSAGES[code];
}
