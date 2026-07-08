// 数据库连接助手：整个 App 共用同一个 Prisma 连接。
// （这段是 Next.js 官方推荐写法，避免开发时反复热重载导致连接过多。）

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
