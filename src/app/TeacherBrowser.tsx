"use client"; // 这个组件有交互（筛选），要在浏览器里运行

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { locationNamesMatch } from "@/data/locations";
import { isActiveMember } from "@/lib/membership";
import type { TeacherListItem } from "@/lib/teachers";
import { UserStatus } from "@/components/UserStatus";
import { TeacherCard } from "@/components/TeacherCard";
import { Pagination } from "@/components/Pagination";
import { SeoLocationPicker } from "@/components/SeoLocationPicker";
import type { User } from "@/lib/user-auth";
import { getSeoLocationSlugsForRecords } from "@/lib/location-seo";
import { MIN_ACCESSIBLE_LOCATION_RECORDS, SITE_NAME } from "@/lib/site-config";

const PAGE_SIZE = 10; // 每页展示 10 条

// 功能入口配置（仿照 App 首页图标区）
const entries = [
  {
    label: "地区信息",
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
  const searchParams = useSearchParams();

  // 兼容旧地区查询参数；可识别的旧地址会由首页服务器永久跳转到新地区页。
  const province = searchParams.get("province") ?? "全部";
  const city = searchParams.get("city") ?? "全部";
  const page = Number(searchParams.get("page")) || 1;

  // "发帖"提示弹窗的显示状态
  const [showPostNotice, setShowPostNotice] = useState(false);

  const availableLocationSlugs = getSeoLocationSlugsForRecords(
    teachers,
    MIN_ACCESSIBLE_LOCATION_RECORDS,
  );

  const setPage = (nextPage: number) => {
    router.replace(nextPage > 1 ? `/?page=${nextPage}` : "/", { scroll: false });
  };

  // 根据筛选条件，过滤出要显示的老师
  // 后台省份/城市是自由填写的，需要兼容省市区后缀、上级城市前缀和更细地址。
  const list = teachers.filter((t) => {
    const okProvince = province === "全部" || locationNamesMatch(t.city, province);
    const okCity = city === "全部" || locationNamesMatch(t.district, city);
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
          <div>
            <h1 className="text-xl font-bold">{SITE_NAME}</h1>
            <p className="mt-0.5 text-xs text-white/80">全国地区信息</p>
          </div>
          <UserStatus username={user?.username} isMember={isActiveMember(user)} />
        </div>
      </header>

      {/* 功能入口：地区信息 / VIP升级 / 推广赚钱 / 发帖 */}
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

      {/* 全国省市始终显示在选择器中；0条资料的地区为灰色，有第1条后自动开放。 */}
      <div className="px-4 pt-4">
        <SeoLocationPicker availableLocationSlugs={[...availableLocationSlugs]} />
      </div>

      {/* 老师卡片列表 */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        {list.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            该地区暂时还没有公开信息
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
