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
import { SITE_NAME } from "@/lib/site-config";
import type { PublicPartnerLink } from "@/lib/partner-links";

// 功能入口配置（仿照 App 首页图标区）
const entries = [
  {
    label: "暗巷",
    href: "/alley",
    feature: "alley" as const,
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
        <path d="M4 21V8l8-5 8 5v13" />
        <path d="M9 21v-7h6v7" />
        <path d="M3 21h18" />
      </svg>
    ),
  },
  {
    label: "按摩SPA",
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
    label: "开通会员",
    href: "/vip",
    feature: "payment" as const,
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
        <path d="m3 7 4 4 5-7 5 7 4-4-2 12H5L3 7Z" />
        <path d="M5 19h14" />
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
  partnerLinks,
  user,
  availableLocationSlugs,
  page,
  totalPages,
  alleyPublicEnabled,
  paymentEnabled,
}: {
  teachers: TeacherCardItem[];
  nationalPromotions: TeacherCardItem[];
  partnerLinks: PublicPartnerLink[];
  user?: User | null;
  availableLocationSlugs: string[];
  page: number;
  totalPages: number;
  alleyPublicEnabled: boolean;
  paymentEnabled: boolean;
}) {
  const router = useRouter();

  const [notice, setNotice] = useState<"contact" | null>(null);
  const visibleEntries = entries.filter(
    (entry) =>
      (entry.feature !== "alley" || alleyPublicEnabled) &&
      (entry.feature !== "payment" || paymentEnabled),
  );
  const entryGridColumns =
    visibleEntries.length >= 5
      ? "grid-cols-5"
      : visibleEntries.length === 4
        ? "grid-cols-4"
        : "grid-cols-3";

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
            <h1 className="text-xl font-bold">{SITE_NAME}</h1>
            <p className="mt-0.5 text-xs text-white/80">全国地区信息</p>
          </div>
          <UserStatus
            username={user?.username}
            isMember={isActiveMember(user)}
          />
        </div>
      </header>

      {/* 关闭中的功能不会出现在前台入口中。 */}
      <div className="px-4 pt-4">
        <div
          className={`grid ${entryGridColumns} gap-1 rounded-2xl bg-white p-3 shadow-sm`}
        >
          {visibleEntries.map((e) =>
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

      {partnerLinks.length > 0 && (
        <section className="mx-4 mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">合作伙伴</h2>
              <p className="mt-0.5 text-xs text-gray-400">优质网站推荐</p>
            </div>
            <span className="rounded-full bg-pink-50 px-2.5 py-1 text-xs text-pink-500">
              友情链接
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {partnerLinks.map((partner) => (
              <a
                key={partner.id}
                href={partner.url}
                target="_blank"
                rel={
                  partner.linkType === "sponsored"
                    ? "sponsored nofollow noopener noreferrer"
                    : "noopener noreferrer"
                }
                className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 active:bg-pink-50"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-pink-50 text-sm text-pink-500">
                  🔗
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-gray-700">
                    {partner.name}
                  </span>
                  {partner.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                      {partner.description}
                    </span>
                  )}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
