// 用户身份认证助手（注册、登录、JWT 校验）
// 使用 JWT（JSON Web Token）存储登录状态，安全且无需数据库存 session。

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { generateUniqueReferralCode } from "@/lib/referral";
import type { User as UserRow } from "@prisma/client";

const REF_COOKIE_NAME = "ref_code"; // 与 /r/[code] 路由里写的 cookie 同名

// 页面使用的"用户"格式（去掉敏感字段）
export type User = {
  id: number;
  username: string;
  email: string | null;
  isMember: boolean;
  membershipExpiresAt: Date | null;
};

// 注册时接收的数据（邮箱选填）
export type RegisterInput = {
  username: string;
  email?: string;
  password: string;
};

// 登录时接收的数据（可以用用户名或邮箱登录）
export type LoginInput = {
  usernameOrEmail: string;
  password: string;
};

// ========== 密码哈希 ==========

const SALT_ROUNDS = 10;

// 加密密码（注册时调用）
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// 验证密码（登录时调用）
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ========== JWT 令牌 ==========

const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE_NAME = "user_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

// 生成 JWT（包含用户基本信息）
function createToken(user: UserRow): string {
  const payload: User = {
    id: user.id,
    username: user.username,
    email: user.email,
    isMember: user.isMember,
    membershipExpiresAt: user.membershipExpiresAt,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// 验证 JWT，返回用户信息（失败返回 null）
function verifyToken(token: string): User | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as User;
    return payload;
  } catch {
    return null;
  }
}

// ========== 登录状态管理 ==========

// 当前请求是否已登录
export async function isLoggedIn(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) !== null : false;
}

// 获取当前登录的用户信息（未登录返回 null）
// 以数据库为准读取最新的会员状态：后台开通/取消会员后，用户下次请求即生效，
// 无需重新登录；被删除的用户其令牌也会立即失效。
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyToken(token); // 先验令牌，拿到用户 id
  if (!payload) return null;

  const row = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!row) return null; // 用户已被删除
  if (row.isBanned) return null; // 已被封禁，视为登出（下次登录会被 loginUser 拦截并提示）

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    isMember: row.isMember,
    membershipExpiresAt: row.membershipExpiresAt,
  };
}

// 要求必须登录，否则跳转到登录页（保护页面用）
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

// 要求必须是会员，否则提示或跳转（查看联系方式用）
export async function requireMember(): Promise<User> {
  const user = await requireUser();
  if (!user.isMember) {
    // 这里可以跳转到会员开通页面，暂时先提示
    // 实际使用时根据需求调整
    throw new Error("需要开通会员才能查看联系方式");
  }
  return user;
}

// ========== 注册 / 登录 / 登出 ==========

// 同一 IP 24小时内注册账号数达到这个数量，判定为批量注册：
// 拒绝这次注册，并把该 IP 名下这段时间注册的账号全部标记为封禁（需管理员手动解封）。
// "unknown"（拿不到真实 IP，比如 Nginx 没转发 X-Forwarded-For）时跳过检测，避免把所有访客误判成同一个人。
const BULK_REGISTER_BAN_THRESHOLD = 8;

async function checkAndBanBulkRegistration(ip: string) {
  if (ip === "unknown") return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentFromIp = await prisma.user.findMany({
    where: { registrationIp: ip, createdAt: { gte: since } },
    select: { id: true },
  });

  if (recentFromIp.length >= BULK_REGISTER_BAN_THRESHOLD) {
    await prisma.user.updateMany({
      where: { id: { in: recentFromIp.map((u) => u.id) } },
      data: { isBanned: true, bannedAt: new Date(), banReason: "同一IP短时间内批量注册" },
    });
    throw new Error("检测到批量注册，账号已被限制，请联系管理员");
  }
}

// 注册新用户
export async function registerUser(input: RegisterInput, ip: string): Promise<User> {
  // 检查用户名是否已存在
  const existingUsername = await prisma.user.findUnique({
    where: { username: input.username },
  });
  if (existingUsername) {
    throw new Error("用户名已存在");
  }

  // 邮箱选填：填了才检查是否已被占用
  if (input.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existingEmail) {
      throw new Error("邮箱已被注册");
    }
  }

  await checkAndBanBulkRegistration(ip);

  // 哈希密码
  const passwordHash = await hashPassword(input.password);

  // 生成该用户自己的专属邀请码
  const referralCode = await generateUniqueReferralCode();

  // 邀请关系只在注册这一刻绑定一次：读取 /r/[code] 写入的 cookie，
  // 查到有效推荐人就记下来，此后终身不变（老用户点邀请链接不算数）
  const store = await cookies();
  const refCode = store.get(REF_COOKIE_NAME)?.value;
  let referredBy: number | null = null;
  if (refCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: refCode } });
    if (referrer) referredBy = referrer.id;
  }

  // 创建用户
  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: input.email ?? null,
      passwordHash,
      isMember: false, // 新用户默认不是会员
      referralCode,
      referredBy,
      registrationIp: ip === "unknown" ? null : ip,
    },
  });

  // 返回用户信息（不含密码）
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isMember: user.isMember,
    membershipExpiresAt: user.membershipExpiresAt,
  };
}

// 用户登录（支持用户名或邮箱）
export async function loginUser(input: LoginInput): Promise<User> {
  // 判断是用户名还是邮箱（简单通过是否包含 @ 判断）
  const isEmail = input.usernameOrEmail.includes("@");

  const user = await prisma.user.findUnique({
    where: isEmail
      ? { email: input.usernameOrEmail }
      : { username: input.usernameOrEmail },
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  if (user.isBanned) {
    throw new Error("该账号已被封禁，如有疑问请联系管理员");
  }

  // 验证密码
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new Error("密码不正确");
  }

  // 生成 JWT 并写入 Cookie
  const token = createToken(user);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true, // 前端 JS 读不到，更安全
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  // 返回用户信息
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isMember: user.isMember,
    membershipExpiresAt: user.membershipExpiresAt,
  };
}

// 退出登录
export async function logoutUser(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// 重新签发当前登录用户的令牌。
// 会员状态（isMember 等）存在 JWT 里，后台/支付改动数据库后，
// 调用这个方法用最新数据重签 Cookie，用户无需重新登录即可生效。
export async function refreshSession(): Promise<void> {
  const current = await getCurrentUser();
  if (!current) return;
  const user = await prisma.user.findUnique({ where: { id: current.id } });
  if (!user) return;

  const token = createToken(user);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}