import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "防骗指南",
  description: "了解如何辨别虚假联系方式，以及信息过时、联系方式无效等常见问题。",
};

const scamSigns = [
  "当你对联系对方有所顾虑的时候，请您尝试百度一下这个联系方式，进行多方的比对。",
  "凡是要求付路费/红包/定金/保证金/照片验证/视频验证等任何提前付费的行为，基本都是骗子。",
  "凡是裸聊、发视频验证、下载APP的，都是来骗钱或窃取个人资料的，请勿上当。",
  "凡是进入服务场所后没有提供服务就一直推荐办卡都是骗子。",
  "凡是对服务项目含糊其辞的，都是有时候猫腻的，事前一定要问清楚。",
  "凡是要求见面地方在交通方便的车站附近的，基本不靠谱。",
];

const questions = [
  {
    title: "为什么网站有一些信息过时了?",
    content:
      "由于行业的特殊性，如果这条信息发布时间半年多了，过时了也正常，但请放心，本站每日大量更新全国信息，我们也建议你更多关注最新的信息。",
  },
  {
    title: "为什么有些信息的联系方式无效？",
    content:
      "由于行业的特殊性，老师或者商家联系方式更换比较频繁，同时如果这条信息被很多用户浏览和添加，也会导致微信或者QQ联系方式被暂时屏蔽或者直接被封。如果你无法搜索QQ和微信，这个时候请你尝试一下手机联系方式，如果长期没回复或者联系方式失效且无法添加，请关注我们同城的其它最新信息即可，我们每日更新大量全国信息，通过我们的最新信息，总会帮你找到快乐和性福。",
  },
  {
    title: "网站的信息都是真的吗?",
    content:
      "本站信息都是全国各地狼友亲自经历后发布的，再由我们网站严格审核后才通过，所以可信度请放心。每天那么多的信息更新，我们没有你们想象的那么强大，可以捏造出这么多虚假信息，同时如果你有顾虑。",
  },
];

export default function SafetyGuidePage() {
  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">防骗指南</h1>
      </header>

      <main className="px-4 pt-4">
        <section className="rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-red-100 text-xl"
              aria-hidden="true"
            >
              🛡️
            </span>
            <h2 className="pt-1 text-lg font-bold leading-7 text-gray-900">
              怎么辨别和鉴定虚假联系方式？骗子有一些显著特征呢?
            </h2>
          </div>

          <ul className="mt-4 space-y-3">
            {scamSigns.map((item, index) => (
              <li key={item} className="flex gap-3 rounded-xl bg-red-50 p-3 text-sm leading-6 text-gray-700">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600">
                  {index + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-4 space-y-4">
          {questions.map((question) => (
            <section key={question.title} className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-bold text-gray-900">{question.title}</h2>
              <p className="mt-3 text-sm leading-7 text-gray-600">{question.content}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}