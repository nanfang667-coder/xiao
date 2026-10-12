import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPromotionChannelStats } from "@/lib/promotion-channel-stats";
import { SITE_URL } from "@/lib/site-config";
import { ChannelStatusForm, ChannelTarget, CreateChannelForm, EditChannelForm } from "./ChannelForms";

export default async function PromotionChannelsPage() {
  await requireAdmin();
  let channels: Awaited<ReturnType<typeof getPromotionChannelStats>> = [];
  let setupNeeded = false;
  try {
    channels = await getPromotionChannelStats();
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2021") throw error;
    setupNeeded = true;
  }

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="text-lg font-bold">推广渠道</h1>
        <Link href="/adminzhangzhang/users" className="ml-auto text-xs text-white/90">邀请码统计</Link>
      </header>

      <div className="mb-4 rounded-2xl bg-pink-50 p-4 text-xs leading-relaxed text-gray-600">
        <p>按短链分别统计到访浏览器，与用户邀请码分别记录，不改变邀请关系。</p>
        <p className="mt-2">今日新增按北京时间统计首次到访该渠道的浏览器；近24小时统计期间到访过的浏览器。累计独立访客按浏览器去重，访问次数包含重复打开。</p>
        <p className="mt-2">不同渠道可能包含同一个访客，不能相加当成全站人数。换设备或清除 Cookie 可能重新计数；这里统计访问，不代表注册人数。</p>
      </div>

      {setupNeeded ? (
        <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">渠道功能尚未完成数据库更新，请先完成部署后再创建渠道。</p>
      ) : <CreateChannelForm />}

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="font-bold text-gray-800">渠道列表 · {channels.length}</h2>
        <span className="text-xs text-gray-400">按累计独立访客从高到低</span>
      </div>
      {setupNeeded ? null : channels.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-gray-500">还没有渠道，先为 gp77.top 创建一个。</p>
      ) : (
        <div className="space-y-4">
          {channels.map(channel => (
            <article key={channel.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words font-bold text-gray-800">{channel.name}</h3>
                  <p className="mt-1 break-all text-sm text-pink-600">{channel.hostname}</p>
                  <p className="mt-1 text-xs text-gray-400">渠道标识：{channel.code}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${channel.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{channel.isActive ? "统计中" : "已停用"}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                {([
                  ["今日新增访客", channel.todayNewVisitors],
                  ["近24小时访客", channel.last24HourVisitors],
                  ["累计独立访客", channel.totalVisitors],
                  ["访问次数", channel.visitCount],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-gray-50 p-3">
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="mt-1 text-xl font-bold text-pink-500">{value.toLocaleString("zh-CN")}</dd>
                  </div>
                ))}
              </dl>
              <ChannelTarget url={`${SITE_URL}/go/${channel.code}`} />
              <EditChannelForm channel={{ id: channel.id, name: channel.name, hostname: channel.hostname, code: channel.code }} />
              <ChannelStatusForm id={channel.id} isActive={channel.isActive} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
