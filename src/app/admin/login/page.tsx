import { login } from "../actions";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">后台管理登录</h1>
        <p className="mt-1 text-sm text-gray-500">请输入管理员密码</p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            密码不正确，请重试
          </p>
        )}

        <form action={login} className="mt-4 space-y-3">
          <input
            type="password"
            name="password"
            placeholder="管理员密码"
            required
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-pink-500 py-2 text-sm font-bold text-white active:bg-pink-600"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
