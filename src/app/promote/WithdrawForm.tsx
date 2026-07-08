"use client"; // 有交互（切换收款方式），要在浏览器运行

import { useState } from "react";
import { createWithdrawal } from "./actions";
import { USDT_NETWORKS, WITHDRAW_METHODS, MIN_WITHDRAW_AMOUNT } from "@/lib/membership";
import type { WithdrawMethodKey } from "@/lib/membership";

const ACCOUNT_LABEL: Record<WithdrawMethodKey, string> = {
  usdt: "USDT 收款地址",
  alipay: "支付宝账号",
  wechat: "微信收款码/账号",
};

const ACCOUNT_PLACEHOLDER: Record<WithdrawMethodKey, string> = {
  usdt: "请输入你的 USDT 钱包地址",
  alipay: "请输入支付宝账号（手机号/邮箱）",
  wechat: "请输入微信号或收款码链接",
};

export function WithdrawForm({ available }: { available: number }) {
  const [method, setMethod] = useState<WithdrawMethodKey>("usdt");
  const [network, setNetwork] = useState<string>(USDT_NETWORKS[0]);
  const canWithdraw = available >= MIN_WITHDRAW_AMOUNT;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-800">申请提现</h2>

      {!canWithdraw ? (
        <p className="py-4 text-center text-sm text-gray-400">
          可提现余额需满 ¥{MIN_WITHDRAW_AMOUNT} 才能申请，继续邀请好友攒佣金吧～
        </p>
      ) : (
        <form action={createWithdrawal} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              收款方式
            </label>
            <select
              name="payMethod"
              value={method}
              onChange={(e) => setMethod(e.target.value as WithdrawMethodKey)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            >
              {WITHDRAW_METHODS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {method === "usdt" && (
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
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {ACCOUNT_LABEL[method]}
            </label>
            <input
              name="account"
              required
              placeholder={ACCOUNT_PLACEHOLDER[method]}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            />
          </div>

          <p className="text-xs text-gray-400">
            本次可提现 ¥{available.toFixed(1)}，请仔细核对收款信息，转错概不负责
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
