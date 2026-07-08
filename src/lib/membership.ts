// 会员套餐配置（目前只有一种：永久会员）。
// 以后要加档位或改价格，只改这里即可。

export const MEMBERSHIP_PLAN = {
  name: "永久会员",
  price: 38, // 元
  benefits: [
    "查看老师联系方式（电话 / 微信 / QQ）",
    "查看小巷子清晰图片",
    "查看小巷子位置信息",
    "永久有效，一次开通终身可用",
  ],
};

// 推广返佣比例：被邀请人开通会员时，邀请人拿到的分成比例
export const COMMISSION_RATE = 0.45;

// 提现支持的 USDT 网络类型
export const USDT_NETWORKS = ["TRC20", "ERC20", "BEP20"] as const;

// 最低提现金额（人民币），避免零碎金额也来申请，增加人工处理成本
export const MIN_WITHDRAW_AMOUNT = 10;

// 提现功能总开关：接入真实支付前必须为 false，否则等于自己邀请自己就能套出真实 USDT。
export function withdrawalsEnabled(): boolean {
  return process.env.WITHDRAWALS_ENABLED === "true";
}

// 支付方式
export const PAY_METHODS = [
  { key: "wechat", label: "微信支付", emoji: "💚" },
  { key: "alipay", label: "支付宝", emoji: "💙" },
] as const;

export type PayMethodKey = (typeof PAY_METHODS)[number]["key"];

// 把支付方式代号转成中文名（用于订单页显示）
export function payMethodLabel(key: string): string {
  return PAY_METHODS.find((m) => m.key === key)?.label ?? key;
}

// 判断是否为“有效会员”：不仅 isMember 为真，还要没过期。
// membershipExpiresAt 为空表示永久会员；有值则必须晚于当前时间。
// 用它替代到处直接读 isMember，避免到期会员仍享有权限。
export function isActiveMember(
  user:
    | { isMember?: boolean; membershipExpiresAt?: Date | string | null }
    | null
    | undefined
): boolean {
  if (!user?.isMember) return false;
  if (!user.membershipExpiresAt) return true; // 永久会员
  return new Date(user.membershipExpiresAt).getTime() > Date.now();
}
