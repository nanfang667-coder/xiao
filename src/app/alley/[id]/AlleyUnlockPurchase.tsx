"use client";

import { useFormStatus } from "react-dom";
import { PAY_METHODS } from "@/lib/membership";
import { PaymentRedirectNotice } from "@/components/PaymentRedirectNotice";
import { createAlleyUnlockOrder } from "./actions";

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
        : `¥${price} 永久解锁本帖`}
    </button>
  );
}

export function AlleyUnlockPurchase({
  alleyPostId,
  price,
}: {
  alleyPostId: number;
  price: number;
}) {
  const action = createAlleyUnlockOrder.bind(null, alleyPostId);
  const method = PAY_METHODS[0];

  return (
    <form action={action}>
      <input type="hidden" name="payMethod" value={method.key} />
      <div className="mb-3 flex items-center justify-between rounded-xl bg-pink-50 p-3 text-sm">
        <span className="font-medium text-gray-700">
          {method.emoji} {method.label}
        </span>
        <span className="font-bold text-rose-500">
          ¥{price}
        </span>
      </div>
      <UnlockButton price={price} />
      <p className="mt-2 text-center text-xs text-gray-400">
        付款成功后，本账号可永久查看当前帖子
      </p>
      <PaymentRedirectNotice />
    </form>
  );
}
