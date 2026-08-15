export const SITE_URL = "https://fenglou1.com";
export const SITE_NAME = "凤楼";

const LOCAL_SITE_URL = "http://localhost:3000";

export function getTrustedSiteOrigin(nodeEnv = process.env.NODE_ENV): string {
  return nodeEnv === "production" ? SITE_URL : LOCAL_SITE_URL;
}

// 地区只要有一条公开资料，就开放访问、进入 Sitemap 并允许搜索引擎收录。
// 没有公开资料的地区页返回 404，也不在站内地区导航中提供链接。
export const MIN_ACCESSIBLE_LOCATION_RECORDS = 1;
