// 从数据库读取老师信息，并整理成页面好用的格式。
// （页面不用直接跟数据库打交道，都通过这里的函数。）

import { prisma } from "./prisma";
import type { Teacher as TeacherRow } from "@prisma/client";

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
  photos: string[];
  emoji: string;
  contact: { phone: string; wechat: string; qq: string | null };
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
    photos,
    emoji: row.emoji,
    contact: { phone: row.phone, wechat: row.wechat, qq: row.qq },
  };
}

// 取出所有老师（最新的排前面）
export async function getAllTeachers(): Promise<Teacher[]> {
  const rows = await prisma.teacher.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toTeacher);
}

// 列表用的老师格式：不含联系方式（会员专属，不能发到浏览器）
export type TeacherListItem = Omit<Teacher, "contact">;

// 取出所有老师供列表展示——去掉 contact，避免联系方式随页面源码泄露给非会员
export async function getTeachersForList(): Promise<TeacherListItem[]> {
  const rows = await prisma.teacher.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => {
    const { contact, ...rest } = toTeacher(row); // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  });
}

// 按编号取一位老师
export async function getTeacherById(id: string): Promise<Teacher | null> {
  const numId = Number(id);
  if (Number.isNaN(numId)) return null;
  const row = await prisma.teacher.findUnique({ where: { id: numId } });
  return row ? toTeacher(row) : null;
}
