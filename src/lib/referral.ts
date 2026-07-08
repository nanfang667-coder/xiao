// 推广邀请相关的小助手函数：生成专属邀请码。

import { prisma } from "./prisma";

// 去掉容易看混的字符（0/O、1/I/L），方便用户口头或手动分享邀请码
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// 生成一个全站唯一的邀请码（极小概率冲突时重试几次）
export async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    const exists = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  throw new Error("生成邀请码失败，请重试");
}
