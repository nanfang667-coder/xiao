import { redirect } from "next/navigation";
import { getTeamAccount } from "@/lib/team-auth";
import { teamLogin } from "../actions";

export default async function TeamLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getTeamAccount()) redirect("/team");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">团队数据看板</h1>
        <p className="mt-1 text-sm text-gray-500">只读账号，仅查看所属网站统计</p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            账号或密码错误，请稍后重试
          </p>
        )}
        <form action={teamLogin} className="mt-4 space-y-3">
          <input
            name="username"
            required
            autoComplete="username"
            placeholder="团队账号"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
          />
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="密码"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
          />
          <button className="w-full rounded-lg bg-pink-500 py-2.5 text-sm font-bold text-white">
            登录查看
          </button>
        </form>
      </div>
    </main>
  );
}
