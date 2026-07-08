"use client"; // 有交互（选择网络类型），要在浏览器运行

import { useState } from "react";
import { createWithdrawal } from "./actions";
import { USDT_NETWORKS, MIN_WITHDRAW_AMOUNT } from "@/lib/membership";

export function WithdrawForm({ available }: { available: number }) {
  const [network, setNetwork] = useState<string>(USDT_NETWORKS[0]);
  const canWithdraw = available >= MIN_WITHDRAW_AMOUNT;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-800">申请提现（USDT）</h2>

      {!canWithdraw ? (
        <p className="py-4 text-center text-sm text-gray-400">
          可提现余额需满 ¥{MIN_WITHDRAW_AMOUNT} 才能申请，继续邀请好友攒佣金吧～
        </p>
      ) : (
        <form action={createWithdrawal} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              USDT 网络
            </label>
            <select
              name="network"
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            >
              {USDT_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              USDT 收款地址
            </label>
            <input
              name="usdtAddress"
              required
              placeholder="请输入你的 USDT 钱包地址"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            />
          </div>
          <p className="text-xs text-gray-400">
            本次可提现 ¥{available.toFixed(1)}，请仔细核对地址，转错概不负责
          </p>
          <button
            type="submit"
            className="w-full rounded-lg bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600"
          >
            申请提现
          </button>
        </form>
      )}
    </div>
  );
}
