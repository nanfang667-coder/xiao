// 从数据库读取"小巷子信息"，并整理成页面好用的格式。
// （页面不用直接跟数据库打交道，都通过这里的函数。）

import { prisma } from "./prisma";
import type { Alley as AlleyRow } from "@prisma/client";

// 页面使用的"小巷子信息"格式（photos 是数组，用起来更方便）
export type Alley = {
  id: string;
  title: string;
  intro: string;
  price: string;
  city: string; // 省份（仅用于前台筛选，不展示）
  district: string; // 城市（仅用于前台筛选，不展示）
  location: string; // 具体位置（精确到街道，仅会员可见）
  photos: string[];
};

// 把数据库里的一行，转换成页面用的格式
function toAlley(row: AlleyRow): Alley {
  let photos: string[] = [];
  try {
    photos = JSON.parse(row.photos);
  } catch {
    photos = [];
  }

  return {
    id: String(row.id),
    title: row.title,
    intro: row.intro,
    price: row.price,
    city: row.city,
    district: row.district,
    location: row.location,
    photos,
  };
}

// 取出所有小巷子信息（最新的排前面）
export async function getAllAlleys(): Promise<Alley[]> {
  const rows = await prisma.alley.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toAlley);
}

// 按编号取一条
export async function getAlleyById(id: string): Promise<Alley | null> {
  const numId = Number(id);
  if (Number.isNaN(numId)) return null;
  const row = await prisma.alley.findUnique({ where: { id: numId } });
  return row ? toAlley(row) : null;
}
