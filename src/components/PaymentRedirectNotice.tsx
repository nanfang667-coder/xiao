export function PaymentRedirectNotice() {
  return (
    <div
      role="note"
      aria-label="支付页面提示"
      className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800"
    >
      <p className="font-bold">支付页面提示</p>
      <p className="mt-0.5">
        点击付款后将进入支付宝收银台。若只显示金额、二维码暂未出现，请先等待
        5–10 秒；仍未显示可刷新支付页面，或点击“打开支付宝APP继续付款”。请勿重复付款。
      </p>
    </div>
  );
}
