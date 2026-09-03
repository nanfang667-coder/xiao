import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createSite,
  createTeamAccount,
  disableTeamAccount,
  resetTeamPassword,
  updateSite,
} from "./actions";

function PriceInputs({
  values,
}: {
  values?: {
    singlePostPrice: number;
    membershipPrice: number;
    membershipOriginalPrice: number;
  };
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className="text-xs text-gray-500">
        单篇价格
        <input
          name="singlePostPrice"
          type="number"
          min="0.01"
          max="100000"
          step="0.01"
          required
          defaultValue={values?.singlePostPrice ?? 10}
          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
        />
      </label>
      <label className="text-xs text-gray-500">
        永久会员
        <input
          name="membershipPrice"
          type="number"
          min="0.01"
          max="100000"
          step="0.01"
          required
          defaultValue={values?.membershipPrice ?? 38}
          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
        />
      </label>
      <label className="text-xs text-gray-500">
        会员原价
        <input
          name="membershipOriginalPrice"
          type="number"
          min="0.01"
          max="100000"
          step="0.01"
          required
          defaultValue={values?.membershipOriginalPrice ?? 58}
          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
        />
      </label>
    </div>
  );
}

export default async function SiteManagementPage() {
  await requireAdmin();
  const sites = await prisma.site.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { teamAccounts: { orderBy: { createdAt: "asc" } } },
  });
  const siteStats = new Map(
    await Promise.all(
      sites.map(async (site) => {
        const [users, members, revenue] = await Promise.all([
          prisma.user.count({ where: { siteId: site.id } }),
          prisma.user.count({ where: { siteId: site.id, isMember: true } }),
          prisma.order.aggregate({
            where: { siteId: site.id, status: "paid" },
            _sum: { amount: true },
          }),
        ]);
        return [
          site.id,
          { users, members, revenue: revenue._sum.amount ?? 0 },
        ] as const;
      }),
    ),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="font-bold">网站、定价与团队账号</h1>
      </header>

      <section className="space-y-4">
        {sites.map((site) => (
          <div key={site.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">
                {site.name}
                {site.isDefault && (
                  <span className="ml-2 rounded-full bg-pink-50 px-2 py-0.5 text-xs text-pink-500">
                    默认站
                  </span>
                )}
              </h2>
              <span className="text-xs text-gray-400">{site.hostname}</span>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {[
                ["用户", siteStats.get(site.id)?.users ?? 0],
                ["会员", siteStats.get(site.id)?.members ?? 0],
                ["累计收入", `¥${(siteStats.get(site.id)?.revenue ?? 0).toFixed(2)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-gray-50 p-2 text-center">
                  <p className="text-base font-bold text-pink-500">{value}</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              ))}
            </div>
            <form action={updateSite.bind(null, site.id)} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  name="name"
                  required
                  maxLength={50}
                  defaultValue={site.name}
                  placeholder="网站名称"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <input
                  name="hostname"
                  required
                  defaultValue={site.hostname}
                  placeholder="域名，不带 https://"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <PriceInputs values={site} />
              <button className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white">
                保存本站设置
              </button>
            </form>

            <div className="mt-4 border-t border-gray-100 pt-4">
              <h3 className="text-sm font-bold text-gray-700">合作发布账号</h3>
              {site.teamAccounts.map((account) => (
                <div key={account.id} className="mt-2 rounded-xl bg-gray-50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{account.username}</span>
                    <span className={account.isActive ? "text-green-600" : "text-gray-400"}>
                      {account.isActive ? "使用中" : "已停用"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={resetTeamPassword.bind(null, account.id)} className="flex gap-2">
                      <input
                        type="password"
                        name="password"
                        required
                        minLength={12}
                        placeholder="新密码（至少12位）"
                        className="w-48 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
                      />
                      <button className="rounded-lg border border-pink-200 px-2 py-1.5 text-xs text-pink-600">
                        重设并启用
                      </button>
                    </form>
                    {account.isActive && (
                      <form action={disableTeamAccount.bind(null, account.id)}>
                        <button className="rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-600">
                          停用账号
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
              <form action={createTeamAccount} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input type="hidden" name="siteId" value={site.id} />
                <input
                  name="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
                  placeholder="新合作账号"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  placeholder="初始密码（至少12位）"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <button className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-bold text-white">
                  创建
                </button>
              </form>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-dashed border-pink-200 bg-pink-50/50 p-4">
        <h2 className="font-bold text-gray-800">新增网站</h2>
        <form action={createSite} className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              name="name"
              required
              maxLength={50}
              placeholder="网站名称"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              name="hostname"
              required
              placeholder="新域名，例如 b.example.com"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <PriceInputs />
          <button className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white">
            创建新网站
          </button>
        </form>
      </section>
    </main>
  );
}
