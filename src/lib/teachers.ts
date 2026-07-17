// 从数据库读取老师信息，并整理成页面好用的格式。
// （页面不用直接跟数据库打交道，都通过这里的函数。）

import { prisma } from "./prisma";
import type { Prisma, Teacher as TeacherRow } from "@prisma/client";
import {
  citiesOfProvince,
  locationNamesMatch,
  normalizeLocationName,
  normalizeProvince,
  provinces,
} from "@/data/locations";

// 页面使用的"老师"格式（photos 是数组、contact 是对象，用起来更方便）
export type Teacher = {
  id: string;
  name: string;
  type: "钢琴" | "舞蹈";
  city: string;
  district: string;
  price: string;
  services: string;
  courseNotes: string | null; // 教学案例/课程记录
  age: string | null; // 年龄（选填，支持单个数字或区间，如"28"、"25-30"）
  photos: string[];
  emoji: string;
  contact: {
    phone: string;
    wechat: string;
    qq: string | null;
    other: string | null;
    address: string | null;
  };
  createdAt: Date;
};

// 把数据库里的一行，转换成页面用的格式
function toTeacher(row: TeacherRow): Teacher {
  let photos: string[] = [];
  try {
    photos = JSON.parse(row.photos); // 存的是 JSON 文本，读出来转回数组
  } catch {
    photos = [];
  }

  return {
    id: String(row.id),
    name: row.name,
    type: row.type as "钢琴" | "舞蹈",
    city: row.city,
    district: row.district,
    price: row.price,
    services: row.services,
    courseNotes: row.courseNotes,
    age: row.age,
    photos,
    emoji: row.emoji,
    contact: {
      phone: row.phone,
      wechat: row.wechat,
      qq: row.qq,
      other: row.otherContact,
      address: row.address,
    },
    createdAt: row.createdAt,
  };
}

// 取出所有老师（最新的排前面）
export async function getAllTeachers(): Promise<Teacher[]> {
  const rows = await prisma.teacher.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toTeacher);
}

export type AdminTeacherFilters = {
  province: string;
  city: string;
  query: string;
  page: number;
  pageSize: number;
};

export type AdminTeacherListItem = Pick<
  Teacher,
  "id" | "name" | "city" | "district" | "price" | "photos" | "emoji" | "createdAt"
>;

export type AdminTeacherSearchResult = {
  teachers: AdminTeacherListItem[];
  total: number;
  allLocationTotal: number;
  page: number;
  totalPages: number;
  provinceCounts: Record<string, number>;
  cityCounts: Record<string, number>;
};

function locationVariants(value: string): string[] {
  const trimmed = value.trim();
  const normalized = normalizeLocationName(trimmed);
  return [...new Set([trimmed, normalized].filter(Boolean))];
}

function locationFilter(field: "city" | "district", value: string): Prisma.TeacherWhereInput {
  return {
    OR: locationVariants(value).map((variant) => ({
      [field]: { contains: variant },
    })),
  };
}

function findCanonicalLocation(value: string, options: string[]): string | undefined {
  return options.find((option) => locationNamesMatch(value, option));
}

function parsePhotos(photosJson: string): string[] {
  try {
    const photos = JSON.parse(photosJson);
    return Array.isArray(photos) ? photos.filter((photo): photo is string => typeof photo === "string") : [];
  } catch {
    return [];
  }
}

// 后台老师管理使用数据库筛选和分页，避免老师数量增长后把全部记录发到浏览器。
export async function searchTeachersForAdmin(
  filters: AdminTeacherFilters,
): Promise<AdminTeacherSearchResult> {
  const query = filters.query.trim().slice(0, 100);
  const baseConditions: Prisma.TeacherWhereInput[] = [];

  if (query) {
    const numericId = Number(query);
    baseConditions.push({
      OR: [
        ...(Number.isSafeInteger(numericId) && numericId > 0 ? [{ id: numericId }] : []),
        { name: { contains: query } },
        { phone: { contains: query } },
        { wechat: { contains: query } },
      ],
    });
  }

  const baseWhere: Prisma.TeacherWhereInput =
    baseConditions.length > 0 ? { AND: baseConditions } : {};
  const provinceWhere: Prisma.TeacherWhereInput = filters.province
    ? { AND: [baseWhere, locationFilter("city", filters.province)] }
    : baseWhere;
  const listWhere: Prisma.TeacherWhereInput = filters.city
    ? { AND: [provinceWhere, locationFilter("district", filters.city)] }
    : provinceWhere;

  const [total, provinceGroups, cityGroups] = await Promise.all([
    prisma.teacher.count({ where: listWhere }),
    prisma.teacher.groupBy({
      by: ["city"],
      where: baseWhere,
      _count: { _all: true },
    }),
    filters.province
      ? prisma.teacher.groupBy({
          by: ["district"],
          where: provinceWhere,
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(Math.max(1, filters.page), totalPages);
  const rows = await prisma.teacher.findMany({
    where: listWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * filters.pageSize,
    take: filters.pageSize,
    select: {
      id: true,
      name: true,
      city: true,
      district: true,
      price: true,
      photos: true,
      emoji: true,
      createdAt: true,
    },
  });

  const provinceCounts: Record<string, number> = Object.fromEntries(
    provinces.map((province) => [province, 0]),
  );
  for (const group of provinceGroups) {
    const province = normalizeProvince(group.city) ?? findCanonicalLocation(group.city, provinces);
    if (province) provinceCounts[province] += group._count._all;
  }

  const cityOptions = filters.province ? citiesOfProvince(filters.province) : [];
  const cityCounts: Record<string, number> = Object.fromEntries(
    cityOptions.map((city) => [city, 0]),
  );
  for (const group of cityGroups) {
    const city = findCanonicalLocation(group.district, cityOptions);
    if (city) cityCounts[city] += group._count._all;
  }

  return {
    teachers: rows.map((row) => ({
      ...row,
      id: String(row.id),
      photos: parsePhotos(row.photos),
    })),
    total,
    allLocationTotal: provinceGroups.reduce((sum, group) => sum + group._count._all, 0),
    page,
    totalPages,
    provinceCounts,
    cityCounts,
  };
}

// 列表用的老师格式：不含电话/微信/QQ等联系方式（会员专属，不能发到浏览器），但详细地址所有人可见
export type TeacherListItem = Omit<Teacher, "contact"> & { address: string | null };

// 取出所有老师供列表展示——去掉 phone/wechat/qq/other，避免联系方式随页面源码泄露给非会员；
// 详细地址不算敏感联系方式，所有人可见，因此保留
export async function getTeachersForList(): Promise<TeacherListItem[]> {
  const rows = await prisma.teacher.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => {
    const { contact, ...rest } = toTeacher(row);
    return { ...rest, address: contact.address };
  });
}

// 按编号取一位老师
export async function getTeacherById(id: string): Promise<Teacher | null> {
  const numId = Number(id);
  if (Number.isNaN(numId)) return null;
  const row = await prisma.teacher.findUnique({ where: { id: numId } });
  return row ? toTeacher(row) : null;
}

export type TeacherSeo = {
  id: number;
  name: string;
  type: string;
  city: string;
  district: string;
  services: string;
};

// SEO only needs public listing fields. Keep contact details out of the
// metadata query so they cannot accidentally be exposed in page metadata.
export async function getTeacherSeoById(id: string): Promise<TeacherSeo | null> {
  const numId = Number(id);
  if (!Number.isSafeInteger(numId) || numId <= 0) return null;

  return prisma.teacher.findUnique({
    where: { id: numId },
    select: {
      id: true,
      name: true,
      type: true,
      city: true,
      district: true,
      services: true,
    },
  });
}
