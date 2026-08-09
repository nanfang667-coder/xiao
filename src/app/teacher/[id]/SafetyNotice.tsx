export function SafetyNotice() {
  return (
    <dialog
      open
      aria-labelledby="safety-notice-title"
      aria-modal="true"
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none bg-black/40 p-6 open:flex open:items-center open:justify-center"
    >
      <form
        method="dialog"
        className="w-full max-w-xs rounded-2xl bg-white p-5 text-sm leading-relaxed text-gray-700 shadow-xl"
      >
        <p id="safety-notice-title">
          凡是要求提前转账、押金的都可能是骗子，保护好个人财产，
          <span className="font-bold text-red-600">
            对方近期可能较忙，建议提前几天预约。
          </span>
        </p>
        <button
          autoFocus
          type="submit"
          className="mt-4 w-full rounded-lg bg-pink-500 py-2 text-sm font-bold text-white active:bg-pink-600"
        >
          我已阅读
        </button>
      </form>
    </dialog>
  );
}
