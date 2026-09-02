"use server";

import { redirect } from "next/navigation";
import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { isActiveMember } from "@/lib/membership";
import {
  selectedPayMethod,
  startPaymentOrder,
} from "@/lib/payment-order";
import {
  ALLEY_POST_PRODUCT_TYPE,
  ALLEY_UNLOCK_PLAN,
} from "@/lib/payment-products";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/user-auth";
import { getCurrentSite } from "@/lib/site";

export async function createAlleyUnlockOrder(
  alleyPostId: number,
  formData: FormData,
) {
  if (!Number.isSafeInteger(alleyPostId) || alleyPostId <= 0) redirect("/alley");
  const returnPath = `/alley/${alleyPostId}`;
  if (!PAYMENT_FEATURE_ENABLED) redirect(returnPath);

  const user = await requireUser();
  const site = await getCurrentSite();
  if (isActiveMember(user)) redirect(returnPath);

  const alley = await prisma.alleyPost.findFirst({
    where: { id: alleyPostId, isPublished: true },
    select: { id: true, title: true },
  });
  if (!alley) redirect("/alley");

  const alreadyUnlocked = await prisma.order.findFirst({
    where: {
      userId: user.id,
      siteId: user.siteId,
      productType: ALLEY_POST_PRODUCT_TYPE,
      alleyPostId: alley.id,
      status: "paid",
    },
    select: { id: true },
  });
  if (alreadyUnlocked) redirect(returnPath);

  const payMethod = selectedPayMethod(formData.get("payMethod"));
  if (!payMethod) redirect(`${returnPath}?paymentError=method`);

  const result = await startPaymentOrder({
    userId: user.id,
    siteId: user.siteId,
    productType: ALLEY_POST_PRODUCT_TYPE,
    alleyPostId: alley.id,
    teacherPostId: null,
    plan: `${ALLEY_UNLOCK_PLAN.name}：${alley.title}`,
    subject: ALLEY_UNLOCK_PLAN.name,
    amount: site.singlePostPrice,
    payMethod,
  });
  if (!result.ok) redirect(`${returnPath}?paymentError=${result.code}`);
  redirect(result.paymentUrl);
}
