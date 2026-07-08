"use client"; // 这个组件有交互（筛选），要在浏览器里运行

import { useState } from "react";
import Link from "next/link";
import { provinces, citiesOfProvince } from "@/data/locations";
import { isImage } from "@/lib/photo";
import { isActiveMember } from "@/lib/membership";
import type { TeacherListItem } from "@/lib/teachers";
import { UserStatus } from "@/components/UserStatus";
import { Pagination } from "@/components/Pagination";
import type { User } from "@/lib/user-auth";

const PAGE_SIZE = 10; // 每页展示 10 条

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
    label: "小巷子信息",
    href: "/alley",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21V8l6-4 6 4v13" />
        <path d="M15 21V11l6 4v6" />
        <path d="M9 9v.01M9 13v.01M9 17v.01" />
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
];

// 接收从数据库读来的老师列表，负责城市/区筛选与展示
export function TeacherBrowser({ teachers, user }: { teachers: TeacherListItem[]; user?: User | null }) {
  // 两个筛选状态：省份（默认全部）、城市（默认全部）
  const [province, setProvince] = useState<string>("全部");
  const [city, setCity] = useState<string>("全部");
  // 两个面板的展开/收起
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  // 当前页码（从 1 开始）
  const [page, setPage] = useState(1);

  // 当前所选省份下面有哪些城市
  const cityOptions = province === "全部" ? [] : citiesOfProvince(province);

  // 切换省份时，把"城市"重置回"全部"，收起省份面板，并回到第一页
  const handleProvince = (p: string) => {
    setProvince(p);
    setCity("全部");
    setProvinceOpen(false);
    setPage(1);
  };

  const handleCity = (c: string) => {
    setCity(c);
    setCityOpen(false);
    setPage(1);
  };

  // 根据筛选条件，过滤出要显示的老师
  const list = teachers.filter((t) => {
    const okProvince = province === "全部" || t.city === province;
    const okCity = city === "全部" || t.district === city;
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

      {/* 功能入口：老师信息 / 小巷子信息 / VIP升级 / 推广赚钱 */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-4 gap-2 rounded-2xl bg-white p-4 shadow-sm">
          {entries.map((e) => (
            <Link
              key={e.label}
              href={e.href}
              className="flex flex-col items-center gap-2 py-2 active:scale-95 transition"
            >
              <span className="text-pink-500">{e.icon}</span>
              <span className="text-xs font-medium text-gray-700">{e.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* 省份筛选（可展开/收起） */}
      <div className="px-4 pt-4">
        <FilterPanel
          title="省份"
          options={["全部", ...provinces]}
          selected={province}
          open={provinceOpen}
          onToggle={() => setProvinceOpen(!provinceOpen)}
          onSelect={handleProvince}
          moreLabel="更多省份"
        />
      </div>

      {/* 城市筛选（跟着所选省份变化） */}
      <div className="px-4 pt-3">
        <FilterPanel
          title="城市"
          options={["全部", ...cityOptions]}
          selected={city}
          open={cityOpen}
          onToggle={() => setCityOpen(!cityOpen)}
          onSelect={handleCity}
          moreLabel="更多城市"
        />
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

// 可展开/收起的筛选面板（省份、城市共用）
// 收起时：只显示当前选中项 + "更多"按钮；展开时：三列网格显示全部选项 + "收起"按钮
function FilterPanel({
  title,
  options,
  selected,
  open,
  onToggle,
  onSelect,
  moreLabel,
}: {
  title: string;
  options: string[];
  selected: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
  moreLabel: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex-none pt-1 text-sm font-bold text-gray-800">
          {title}：
        </span>

        {open ? (
          // 展开：三列网格 + 收起按钮
          <div className="flex-1">
            <div className="grid grid-cols-3 gap-x-2 gap-y-3">
              {options.map((o) => (
                <button
                  key={o}
                  onClick={() => onSelect(o)}
                  className={`truncate text-left text-sm transition ${
                    selected === o
                      ? "font-bold text-pink-500"
                      : "text-gray-700"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
            <button
              onClick={onToggle}
              className="mt-4 rounded-full border border-pink-400 px-5 py-1.5 text-sm text-pink-500 active:bg-pink-50"
            >
              − 收起
            </button>
          </div>
        ) : (
          // 收起：只显示选中项 + 更多按钮
          <div className="flex flex-1 items-center justify-between gap-3">
            <span className="text-sm font-medium text-pink-500">{selected}</span>
            <button
              onClick={onToggle}
              className="rounded-full border border-pink-400 px-5 py-1.5 text-sm text-pink-500 active:bg-pink-50"
            >
              + {moreLabel}
            </button>
          </div>
        )}
      </div>
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
          <h2 className="mt-1 line-clamp-1 text-sm font-semibold text-gray-800">
            {teacher.name}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
            {teacher.services}
          </p>
        </div>
        <div className="text-sm font-bold text-rose-500">{teacher.price}</div>
      </div>
    </Link>
  );
}
