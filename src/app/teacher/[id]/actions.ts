"use server";

import { redirect } from "next/navigation";
import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { isActiveMember } from "@/lib/membership";
import { selectedPayMethod, startPaymentOrder } from "@/lib/payment-order";
import {
  TEACHER_POST_PRODUCT_TYPE,
  TEACHER_UNLOCK_PLAN,
} from "@/lib/payment-products";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/user-auth";
import { getCurrentSite } from "@/lib/site";

export async function createTeacherUnlockOrder(
  teacherPostId: number,
  formData: FormData,
) {
  if (!Number.isSafeInteger(teacherPostId) || teacherPostId <= 0) redirect("/");
  const returnPath = `/listing/${teacherPostId}`;
  if (!PAYMENT_FEATURE_ENABLED) redirect(returnPath);

  const user = await requireUser();
  const site = await getCurrentSite();
  if (isActiveMember(user)) redirect(returnPath);

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherPostId },
    select: { id: true, name: true },
  });
  if (!teacher) redirect("/");

  const alreadyUnlocked = await prisma.order.findFirst({
    where: {
      userId: user.id,
      siteId: user.siteId,
      productType: TEACHER_POST_PRODUCT_TYPE,
      teacherPostId: teacher.id,
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
    productType: TEACHER_POST_PRODUCT_TYPE,
    alleyPostId: null,
    teacherPostId: teacher.id,
    plan: `${TEACHER_UNLOCK_PLAN.name}：${teacher.name}`,
    subject: TEACHER_UNLOCK_PLAN.name,
    amount: site.singlePostPrice,
    payMethod,
  });
  if (!result.ok) redirect(`${returnPath}?paymentError=${result.code}`);
  redirect(result.paymentUrl);
}
