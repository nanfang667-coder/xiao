"use client"; // 这个组件有交互（筛选），要在浏览器里运行

import { useState } from "react";
import Link from "next/link";
import { provinces, citiesOfProvince } from "@/data/locations";
import { isImage } from "@/lib/photo";
import { Pagination } from "@/components/Pagination";
import type { Alley } from "@/lib/alleys";

const PAGE_SIZE = 10; // 每页展示 10 条

// 接收从数据库读来的小巷子列表，负责省份/城市筛选与展示
// isMember：当前用户是否为会员，决定图片是否模糊、位置是否可见
export function AlleyBrowser({ alleys, isMember }: { alleys: Alley[]; isMember: boolean }) {
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

  // 根据筛选条件，过滤出要显示的小巷子信息
  const list = alleys.filter((a) => {
    const okProvince = province === "全部" || a.city === province;
    const okCity = city === "全部" || a.district === city;
    return okProvince && okCity;
  });

  // 分页：计算总页数、当前页（防越界）、当前页要显示的数据
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageItems = list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部标题栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">小巷子信息</h1>
      </header>

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

      {/* 信息卡片列表 */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        {list.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            该地区暂时还没有信息
          </p>
        )}
        {pageItems.map((a) => (
          <AlleyCard key={a.id} alley={a} isMember={isMember} />
        ))}
      </div>

      {/* 分页控件 */}
      <Pagination page={current} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}

// 可展开/收起的筛选面板（省份、城市共用）
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

// 单张信息卡片
// 位置对所有人可见；仅封面图非会员模糊、会员清晰
function AlleyCard({ alley, isMember }: { alley: Alley; isMember: boolean }) {
  const cover = alley.photos[0];

  return (
    <Link
      href={`/alley/${alley.id}`}
      className="flex overflow-hidden rounded-2xl bg-white shadow-sm active:scale-[0.99] transition"
    >
      {/* 封面图（非会员模糊） */}
      <div className="relative h-24 w-24 flex-none overflow-hidden">
        {cover && isImage(cover) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={alley.title}
            className={`h-full w-full object-cover ${isMember ? "" : "blur-md"}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-300 to-rose-400 text-3xl">
            🏠
          </div>
        )}
        {/* 非会员：图片上加锁标记 */}
        {!isMember && cover && isImage(cover) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 text-xl">
            🔒
          </div>
        )}
      </div>

      {/* 文字信息 */}
      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
          {/* 具体位置：仅会员可见 */}
          <span className="text-xs text-gray-400">
            📍 {isMember ? alley.location : "具体位置会员可见"}
          </span>
          <h2 className="mt-1 line-clamp-1 text-sm font-semibold text-gray-800">
            {alley.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
            {alley.intro}
          </p>
        </div>
        <div className="text-sm font-bold text-rose-500">{alley.price}</div>
      </div>
    </Link>
  );
}
