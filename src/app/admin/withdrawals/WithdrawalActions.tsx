"use client"; // 有确认弹窗，要在浏览器运行

import { markWithdrawalPaid, rejectWithdrawal } from "../actions";

// 标记已发放按钮：人工转完 USDT 后点击
export function MarkPaidButton({ id, amount }: { id: number; amount: number }) {
  const action = markWithdrawalPaid.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`确认已转账 ¥${amount.toFixed(1)} 对应的 USDT 吗？`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white active:bg-amber-600"
      >
        标记已发放
      </button>
    </form>
  );
}

// 驳回按钮：驳回后佣金会解除绑定，恢复用户的可提现余额
export function RejectButton({ id }: { id: number }) {
  const action = rejectWithdrawal.bind(null, id);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("确定驳回这笔提现申请吗？对应佣金会恢复为可提现状态。")) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 active:bg-red-50"
      >
        驳回
      </button>
    </form>
  );
}
