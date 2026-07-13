"use client"; // 这个组件有交互（筛选），要在浏览器里运行

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { provinces, citiesOfProvince } from "@/data/locations";
import { isImage } from "@/lib/photo";
import { isActiveMember } from "@/lib/membership";
import type { TeacherListItem } from "@/lib/teachers";
import { UserStatus } from "@/components/UserStatus";
import { Pagination } from "@/components/Pagination";
import type { User } from "@/lib/user-auth";

const PAGE_SIZE = 10; // 每页展示 10 条

// 把日期显示成 2026-07-09 这样的格式
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 功能入口配置（仿照 App 首页图标区）
const entries = [
  {
    label: "老师信息",
    href: "/",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
      </svg>
    ),
  },
  {
    label: "VIP升级",
    href: "/vip",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6l4 4 5-6 5 6 4-4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    label: "推广赚钱",
    href: "/promote",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3" />
        <path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
        <path d="M17 8h5M19.5 5.5v5" />
      </svg>
    ),
  },
  {
    label: "发帖",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
];

// 接收从数据库读来的老师列表，负责城市/区筛选与展示
export function TeacherBrowser({ teachers, user }: { teachers: TeacherListItem[]; user?: User | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 筛选状态放在网址参数里（?province=xx&city=xx&page=x），而不是纯组件内存状态：
  // 这样从详情页返回时，就算浏览器/Next.js 没有把这个页面从缓存里原样恢复，
  // 只要网址还是同一个，重新渲染也能读到当时选的省份/城市，不会跳回"全部地区"
  const province = searchParams.get("province") ?? "全部";
  const city = searchParams.get("city") ?? "全部";
  const page = Number(searchParams.get("page")) || 1;

  // 当前展开的选择面板：选省份 / 选城市 / 都收起（纯 UI 状态，不需要放进网址）
  const [picker, setPicker] = useState<"province" | "city" | null>(null);
  // "发帖"提示弹窗的显示状态
  const [showPostNotice, setShowPostNotice] = useState(false);

  // 当前所选省份下面有哪些城市
  const cityOptions = province === "全部" ? [] : citiesOfProvince(province);

  // 把新的筛选值写回网址（省略的字段沿用当前值；等于"全部"/第1页时就从网址里去掉，保持网址干净）
  function updateFilters(next: { province?: string; city?: string; page?: number }) {
    const p = next.province ?? province;
    const c = next.city ?? city;
    const pg = next.page ?? page;

    const params = new URLSearchParams();
    if (p !== "全部") params.set("province", p);
    if (c !== "全部") params.set("city", c);
    if (pg > 1) params.set("page", String(pg));

    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // 选完省份：重置城市为"全部"，自动接着展开城市选择（省份没有下级城市时就直接收起）
  const handleProvince = (p: string) => {
    updateFilters({ province: p, city: "全部", page: 1 });
    const opts = p === "全部" ? [] : citiesOfProvince(p);
    setPicker(opts.length > 0 ? "city" : null);
  };

  const handleCity = (c: string) => {
    updateFilters({ city: c, page: 1 });
    setPicker(null);
  };

  const setPage = (pg: number) => updateFilters({ page: pg });

  // 顶部摘要文字：全部地区 / 上海市 / 上海市 · 徐汇区
  const locationSummary =
    province === "全部" ? "全部地区" : city === "全部" ? province : `${province} · ${city}`;

  // 根据筛选条件，过滤出要显示的老师
  // 后台省份/城市是自由填写的（可以粘贴比标准地名更细的内容，比如"深圳市宝安西乡"），
  // 所以这里用"开头匹配"而不是精确相等，否则筛选"深圳市"就会漏掉这类更细的地址
  const list = teachers.filter((t) => {
    // 双向 startsWith：既兼容"存的比筛选详细"（深圳市宝安西乡 vs 深圳市），
    // 也兼容旧数据里漏写了"市/省"后缀的情况（深圳 vs 深圳市）
    const okProvince =
      province === "全部" || t.city.startsWith(province) || province.startsWith(t.city);
    const okCity = city === "全部" || t.district.startsWith(city) || city.startsWith(t.district);
    return okProvince && okCity;
  });

  // 分页：计算总页数、当前页（防越界）、当前页要显示的数据
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageItems = list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部标题栏 */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-pink-500 to-rose-500 px-4 pb-4 pt-6 text-white shadow-md">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">找老师</h1>
          <UserStatus username={user?.username} isMember={isActiveMember(user)} />
        </div>
      </header>

      {/* 功能入口：老师信息 / VIP升级 / 推广赚钱 / 发帖 */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-4 gap-2 rounded-2xl bg-white p-4 shadow-sm">
          {entries.map((e) =>
            e.href ? (
              <Link
                key={e.label}
                href={e.href}
                className="flex flex-col items-center gap-2 py-2 active:scale-95 transition"
              >
                <span className="text-pink-500">{e.icon}</span>
                <span className="text-xs font-medium text-gray-700">{e.label}</span>
              </Link>
            ) : (
              <button
                key={e.label}
                type="button"
                onClick={() => setShowPostNotice(true)}
                className="flex flex-col items-center gap-2 py-2 active:scale-95 transition"
              >
                <span className="text-pink-500">{e.icon}</span>
                <span className="text-xs font-medium text-gray-700">{e.label}</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* "发帖"提示弹窗 */}
      {showPostNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          onClick={() => setShowPostNotice(false)}
        >
          <div
            className="max-w-xs rounded-2xl bg-white p-5 text-sm leading-relaxed text-gray-700 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p>
              为了预防受骗，暂不开放发帖功能，
              <span className="font-bold text-red-600">
                我们所有信息都是大网站观察两天挑选出来的优秀帖子。
              </span>
            </p>
            <button
              type="button"
              onClick={() => setShowPostNotice(false)}
              className="mt-4 w-full rounded-lg bg-pink-500 py-2 text-sm font-bold text-white active:bg-pink-600"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* 地区筛选：先选省份，选完自动展开城市；收起后只显示一行摘要 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-800">📍 {locationSummary}</span>
            <button
              onClick={() =>
                setPicker(picker ? null : province === "全部" ? "province" : "city")
              }
              className="rounded-full border border-pink-400 px-4 py-1.5 text-sm text-pink-500 active:bg-pink-50"
            >
              {picker ? "收起" : "选择地区"}
            </button>
          </div>

          {picker === "province" && (
            <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-3">
              {["全部", ...provinces].map((p) => (
                <button
                  key={p}
                  onClick={() => handleProvince(p)}
                  className={`truncate text-left text-sm transition ${
                    province === p ? "font-bold text-pink-500" : "text-gray-700"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {picker === "city" && (
            <div className="mt-4">
              <button
                onClick={() => setPicker("province")}
                className="mb-3 text-xs text-gray-400"
              >
                ‹ 重新选择省份
              </button>
              <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                {["全部", ...cityOptions].map((c) => (
                  <button
                    key={c}
                    onClick={() => handleCity(c)}
                    className={`truncate text-left text-sm transition ${
                      city === c ? "font-bold text-pink-500" : "text-gray-700"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 老师卡片列表 */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        {list.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            该地区暂时还没有老师信息
          </p>
        )}
        {pageItems.map((t) => (
          <TeacherCard key={t.id} teacher={t} />
        ))}
      </div>

      {/* 分页控件 */}
      <Pagination page={current} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}


// 单张老师卡片
function TeacherCard({ teacher }: { teacher: TeacherListItem }) {
  return (
    <Link
      href={`/teacher/${teacher.id}`}
      className="flex overflow-hidden rounded-2xl bg-white shadow-sm active:scale-[0.99] transition"
    >
      {/* 封面：用第一张照片（真实图片 or 占位色块） */}
      {isImage(teacher.photos[0]) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={teacher.photos[0]}
          alt={teacher.name}
          className="h-24 w-24 flex-none object-cover"
        />
      ) : (
        <div
          className={`flex h-24 w-24 flex-none items-center justify-center bg-gradient-to-br text-4xl ${teacher.photos[0]}`}
        >
          {teacher.emoji}
        </div>
      )}

      {/* 文字信息 */}
      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
          {/* 地区带上区名，例如：上海 · 徐汇区 */}
          <span className="text-xs text-gray-400">
            📍 {teacher.city} · {teacher.district}
          </span>
          {teacher.address && (
            <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{teacher.address}</p>
          )}
          <h2 className="mt-1 line-clamp-1 text-sm font-semibold text-gray-800">
            {teacher.name}
            {teacher.age != null && (
              <span className="ml-2 text-xs font-normal text-gray-400">年龄{teacher.age}</span>
            )}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
            {teacher.services}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            发布于 {formatDate(teacher.createdAt)}
          </p>
        </div>
        <div className="text-sm font-bold text-rose-500">{teacher.price}</div>
      </div>
    </Link>
  );
}
