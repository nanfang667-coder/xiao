"use client";

import { useFormStatus } from "react-dom";
import { PAY_METHODS } from "@/lib/membership";
import { PaymentRedirectNotice } from "@/components/PaymentRedirectNotice";
import { createTeacherUnlockOrder } from "./actions";

function UnlockButton({ price }: { price: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="w-full rounded-full bg-gradient-to-r from-pink-500 to-rose-500 py-3 text-sm font-bold text-white shadow active:opacity-90 disabled:cursor-wait disabled:opacity-70"
    >
      {pending
        ? "正在连接支付平台，请稍候…"
        : `¥${price} 解锁当前帖子`}
    </button>
  );
}

export function TeacherUnlockPurchase({
  teacherPostId,
  price,
}: {
  teacherPostId: number;
  price: number;
}) {
  const action = createTeacherUnlockOrder.bind(null, teacherPostId);
  const method = PAY_METHODS[0];

  return (
    <form action={action}>
      <input type="hidden" name="payMethod" value={method.key} />
      <UnlockButton price={price} />
      <p className="mt-2 text-center text-xs text-gray-400">
        {method.emoji} {method.label} · 付款后当前帖子永久有效
      </p>
      <PaymentRedirectNotice />
    </form>
  );
}
