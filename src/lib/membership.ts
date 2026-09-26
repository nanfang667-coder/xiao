// 判断是否为“有效会员”：不仅 isMember 为真，还要没过期。
// membershipExpiresAt 为空表示永久会员；有值则必须晚于当前时间。
// 用于历史会员状态展示，避免到期后仍显示有效会员标识。
export function isActiveMember(
  user:
    | { isMember?: boolean; membershipExpiresAt?: Date | string | null }
    | null
    | undefined,
): boolean {
  if (!user?.isMember) return false;
  if (!user.membershipExpiresAt) return true; // 永久会员
  return new Date(user.membershipExpiresAt).getTime() > Date.now();
}
