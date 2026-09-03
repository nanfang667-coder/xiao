import "server-only";

import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { isActiveMember } from "@/lib/membership";
import { TEACHER_POST_PRODUCT_TYPE } from "@/lib/payment-products";
import { prisma } from "@/lib/prisma";

type TeacherAccessUser = {
  id: number;
  siteId: string;
  isMember: boolean;
  membershipExpiresAt: Date | string | null;
};

export async function canAccessTeacherContact(
  user: TeacherAccessUser | null | undefined,
  teacherPostId: number,
): Promise<boolean> {
  if (!PAYMENT_FEATURE_ENABLED) return true;
  if (isActiveMember(user)) return true;
  if (!user || !Number.isSafeInteger(teacherPostId) || teacherPostId <= 0) {
    return false;
  }

  const paidOrder = await prisma.order.findFirst({
    where: {
      userId: user.id,
      siteId: user.siteId,
      productType: TEACHER_POST_PRODUCT_TYPE,
      teacherPostId,
      status: "paid",
    },
    select: { id: true },
  });
  return paidOrder !== null;
}
