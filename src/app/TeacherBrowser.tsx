"use client"; // 这个组件有交互（筛选），要在浏览器里运行

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isActiveMember } from "@/lib/membership";
import type { TeacherCardItem } from "@/lib/teachers";
import { UserStatus } from "@/components/UserStatus";
import { TeacherCard } from "@/components/TeacherCard";
import { NationalPromotionCard } from "@/components/NationalPromotionCard";
import { Pagination } from "@/components/Pagination";
import { SeoLocationPicker } from "@/components/SeoLocationPicker";
import type { User } from "@/lib/user-auth";

// 功能入口配置（仿照 App 首页图标区）
const entries = [
  {
    label: "9895会所",
    href: "/spa",
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 10h18" />
        <path d="M5 10v10h14V10" />
        <path d="m4 10 2-6h12l2 6" />
        <path d="M9 20v-6h6v6" />
      </svg>
    ),
  },
  {
    label: "防骗指南",
    href: "/safety",
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "合作发帖",
    action: "contact" as const,
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    ),
  },
];

// 接收从数据库读来的老师列表，负责城市/区筛选与展示
export function TeacherBrowser({
  teachers,
  nationalPromotions,
  user,
  availableLocationSlugs,
  page,
  totalPages,
  siteName,
}: {
  teachers: TeacherCardItem[];
  nationalPromotions: TeacherCardItem[];
  user?: User | null;
  availableLocationSlugs: string[];
  page: number;
  totalPages: number;
  siteName: string;
}) {
  const router = useRouter();

  const [notice, setNotice] = useState<"contact" | null>(null);
  const setPage = (nextPage: number) => {
    router.replace(nextPage > 1 ? `/?page=${nextPage}` : "/", {
      scroll: false,
    });
  };

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部标题栏 */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-pink-500 to-rose-500 px-4 pb-4 pt-6 text-white shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{siteName}</h1>
            <p className="mt-0.5 text-xs text-white/80">全国地区信息</p>
          </div>
          <UserStatus
            username={user?.username}
            isMember={isActiveMember(user)}
          />
        </div>
      </header>

      {/* 前台功能入口。 */}
      <div className="px-4 pt-4">
        <div
          className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-3 shadow-sm"
        >
          {entries.map((e) =>
            e.href ? (
              <Link
                key={e.label}
                href={e.href}
                className="flex flex-col items-center gap-2 py-2 active:scale-95 transition"
              >
                <span className="text-pink-500">{e.icon}</span>
                <span className="whitespace-nowrap text-[11px] font-medium text-gray-700">
                  {e.label}
                </span>
              </Link>
            ) : (
              <button
                key={e.label}
                type="button"
                onClick={() => setNotice(e.action ?? "contact")}
                className="flex flex-col items-center gap-2 py-2 active:scale-95 transition"
              >
                <span className="text-pink-500">{e.icon}</span>
                <span className="whitespace-nowrap text-[11px] font-medium text-gray-700">
                  {e.label}
                </span>
              </button>
            ),
          )}
        </div>
      </div>

      {/* 合作发帖联系方式 */}
      {notice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          onClick={() => setNotice(null)}
        >
          <div
            className="max-w-xs rounded-2xl bg-white p-5 text-sm leading-relaxed text-gray-700 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h2 className="font-bold text-gray-800">合作发帖</h2>
              <p className="mt-2 text-xs text-gray-500">
                如需合作或发布信息，请通过以下方式联系
              </p>
              <div className="mt-3 space-y-2">
                <a
                  href="mailto:liliws1673@outlook.com"
                  className="block text-pink-500"
                >
                  邮箱 liliws1673@outlook.com
                </a>
                <p className="text-pink-500">纸飞机 @zzegunn</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="mt-4 w-full rounded-lg bg-pink-500 py-2 text-sm font-bold text-white active:bg-pink-600"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* 全国省市始终显示在选择器中；0条资料的地区为灰色，有第1条后自动开放。 */}
      <div className="px-4 pt-4">
        <SeoLocationPicker
          availableLocationSlugs={[...availableLocationSlugs]}
        />
      </div>

      {nationalPromotions.map((promotion, index) => (
        <NationalPromotionCard
          key={promotion.id}
          teacher={promotion}
          showHeader={index === 0}
        />
      ))}

      {/* 老师卡片列表 */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        {teachers.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            该地区暂时还没有公开信息
          </p>
        )}
        {teachers.map((t) => (
          <TeacherCard key={t.id} teacher={t} />
        ))}
      </div>

      {/* 分页控件 */}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
