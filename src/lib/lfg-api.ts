import "server-only";

const API_URL = "https://api.lfgapi.com/api.php";

type ApiResponse<T> = { code: number; msg: string; data: T };
export type LfgListItem = { cid: number; shi_id: number; title: string; datetime: number; filter: number };
export type LfgListData = { page: number; page_size: number; total_page: number; list: LfgListItem[] };
export type LfgDetail = LfgListItem & {
  intro?: string; age?: string; appearance?: string; cost?: string; service?: string;
  qq?: string; weixin?: string; telegram?: string; yuni?: string; tel?: string;
  address?: string; images?: string[];
};
type City = { shi_id: number; shi_name: string };
type Province = { sheng_id: number; sheng_name: string };

function token() {
  const value = process.env.LFG_API_TOKEN?.trim();
  if (!value) throw new Error("尚未配置 LFG_API_TOKEN");
  return value;
}

async function request<T>(action: string, params: Record<string, string | number> = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("token", token());
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`上游 API 请求失败（HTTP ${response.status}）`);
  const result = (await response.json()) as ApiResponse<T>;
  if (result.code !== 1) throw new Error(result.msg || "上游 API 返回失败");
  return result.data;
}

export function getLfgList(page = 1) {
  return request<LfgListData>("get_lf_list", { page });
}
export function getLfgDetail(cid: number) {
  return request<LfgDetail>("get_lf_detail", { cid });
}
export async function getCityName(shiId: number) {
  const provinces = await request<Province[]>("get_sheng");
  for (const province of provinces) {
    const cities = await request<City[]>("get_shi", { sheng_id: province.sheng_id });
    const city = cities.find((item) => item.shi_id === shiId);
    if (city) return { province: province.sheng_name, city: city.shi_name };
  }
  return { province: "未知", city: `地区 ${shiId}` };
}
