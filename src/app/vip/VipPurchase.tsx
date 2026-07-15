"use client"; // 有交互：选择支付方式

import { useState } from "react";
import { createOrder } from "./actions";
import { PAY_METHODS, MEMBERSHIP_PLAN } from "@/lib/membership";

// 已登录、未开通会员时显示：选支付方式 + 立即开通。
// 提交后由服务器创建订单并跳转到支付页。
export function VipPurchase() {
  const [method, setMethod] = useState<string>(PAY_METHODS[0].key);

  return (
    <form action={createOrder} className="px-4 pt-4">
      {/* 支付方式选择 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-gray-800">选择支付方式</h2>
        <div className="space-y-2">
          {PAY_METHODS.map((m) => (
            <label
              key={m.key}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                method === m.key
                  ? "border-pink-400 bg-pink-50"
                  : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="payMethod"
                value={m.key}
                checked={method === m.key}
                onChange={() => setMethod(m.key)}
                className="accent-pink-500"
              />
              <span className="text-xl">{m.emoji}</span>
              <span className="text-sm font-medium text-gray-700">{m.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 立即开通 */}
      <button
        type="submit"
        className="mt-6 w-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-base font-bold text-white shadow active:opacity-90"
      >
        立即开通 ¥{MEMBERSHIP_PLAN.price}
      </button>
      <p className="mt-3 text-center text-xs text-gray-400">
        开通即表示同意会员服务协议
      </p>
      <p className="mt-2 text-center text-xs text-gray-500">
        遇到支付问题，请联系
        <a href="mailto:nanfang667@gmail.com" className="ml-1 text-pink-500">
          nanfang667@gmail.com
        </a>
      </p>
    </form>
  );
}
