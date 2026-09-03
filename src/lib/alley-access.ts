import "server-only";

import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { isActiveMember } from "@/lib/membership";
import { ALLEY_POST_PRODUCT_TYPE } from "@/lib/payment-products";
import { prisma } from "@/lib/prisma";

type AlleyAccessUser = {
  id: number;
  siteId: string;
  isMember: boolean;
  membershipExpiresAt: Date | string | null;
};

export async function canAccessAlleyPost(
  user: AlleyAccessUser | null | undefined,
  alleyPostId: number,
): Promise<boolean> {
  if (!PAYMENT_FEATURE_ENABLED) return true;
  if (isActiveMember(user)) return true;
  if (!user || !Number.isSafeInteger(alleyPostId) || alleyPostId <= 0) {
    return false;
  }

  const paidOrder = await prisma.order.findFirst({
    where: {
      userId: user.id,
      siteId: user.siteId,
      productType: ALLEY_POST_PRODUCT_TYPE,
      alleyPostId,
      status: "paid",
    },
    select: { id: true },
  });
  return paidOrder !== null;
}
