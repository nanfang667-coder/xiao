import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherById, getTeacherSeoById } from "@/lib/teachers";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember } from "@/lib/membership";
import { Gallery } from "./Gallery";
import { SafetyNotice } from "./SafetyNotice";
import { BackButton } from "./BackButton";

const SITE_URL = "https://gp77.top";

type TeacherPageProps = {
  params: Promise<{ id: string }>;
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export async function generateMetadata({ params }: TeacherPageProps): Promise<Metadata> {
  const { id } = await params;
  const teacher = await getTeacherSeoById(id);

  if (!teacher) {
    return {
      title: "信息不存在",
      robots: { index: false, follow: false },
    };
  }

  const name = compactText(teacher.name) || `老师 ${teacher.id}`;
  const category = compactText(teacher.type) || "老师";
  const locationParts = [compactText(teacher.city), compactText(teacher.district)].filter(Boolean);
  const location = locationParts.join("·") || "本地";
  const intro = compactText(teacher.services);
  const title = truncate(`${name}｜${location}${category}服务`, 60);
  const description = truncate(
    `${name}提供${location}${category}服务。${intro || "查看服务介绍、价格及相关信息。"}`,
    160,
  );

  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}/teacher/${teacher.id}`,
    },
  };
}

export default async function TeacherDetail({ params }: TeacherPageProps) {
  const { id } = await params;
  const teacher = await getTeacherById(id); // 从数据库读取
  const user = await getCurrentUser(); // 获取当前登录用户（可能为null）
  const member = isActiveMember(user); // 是否有效会员（含到期校验）

  // 找不到这位老师，就显示 404
  if (!teacher) notFound();

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 安全提示弹窗 */}
      <SafetyNotice />

      {/* 顶部返回栏 */}
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <BackButton />
      </div>

      {/* 多张照片：可左右滑动浏览 */}
      <Gallery photos={teacher.photos} emoji={teacher.emoji} />

      <div className="px-4">
        {/* 标题区 */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-400">
            📍 {teacher.city} · {teacher.district}
          </div>
          <h1 className="mt-2 text-lg font-bold text-gray-900">
            {teacher.name}
            {teacher.age != null && (
              <span className="ml-2 text-sm font-normal text-gray-400">年龄{teacher.age}</span>
            )}
          </h1>
          <div className="mt-2 text-xl font-bold text-rose-500">
            {teacher.price}
          </div>
        </div>

        {/* 服务内容 */}
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-gray-800">服务内容</h2>
          <p className="text-sm leading-6 text-gray-600">{teacher.services}</p>
        </section>

        {/* 教学案例/课程记录（有内容才显示） */}
        {teacher.courseNotes && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">教学案例 / 课程记录</h2>
            <p className="whitespace-pre-line text-sm leading-6 text-gray-600">
              {teacher.courseNotes}
            </p>
          </section>
        )}

        {/* 风险提示（所有人可见，不限会员） */}
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          本平台为信息分享平台，不对经历负责，凡是要求定金、视频验证、提前付费等行为可能是骗子，同时也注意任何形式的办卡行为。
        </div>

        {/* 详细地址（所有人可见，不限会员） */}
        {teacher.contact.address && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">详细地址</h2>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="font-medium">{teacher.contact.address}</span>
            </div>
          </section>
        )}

        {/* 联系方式（会员可见） */}
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">联系方式</h2>

          {member ? (
            // 已开通会员：显示真实联系方式
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-gray-400">电话</span>
                <span className="font-medium">{teacher.contact.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-gray-400">微信</span>
                <span className="font-medium">{teacher.contact.wechat}</span>
              </div>
              {teacher.contact.qq && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-gray-400">QQ</span>
                  <span className="font-medium">{teacher.contact.qq}</span>
                </div>
              )}
              {teacher.contact.other && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-gray-400">其他</span>
                  <span className="font-medium">{teacher.contact.other}</span>
                </div>
              )}
            </div>
          ) : (
            // 未开通会员：锁定状态
            <div className="relative overflow-hidden rounded-xl bg-gray-50 p-5 text-center">
              {/* 模糊的假联系方式，营造"就差一点"的效果 */}
              <div className="select-none blur-sm">
                <p className="text-sm text-gray-700">电话：138-****-****</p>
                <p className="mt-1 text-sm text-gray-700">微信：****_****</p>
                <p className="mt-1 text-sm text-gray-700">QQ：*****</p>
              </div>
              <div className="mt-4">
                <div className="mb-2 text-3xl">🔒</div>
                <p className="mb-3 text-sm text-gray-500">
                  {user ? "开通会员，查看老师联系方式" : "请先登录后开通会员"}
                </p>
                {user ? (
                  <Link href="/vip" className="inline-block rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-2 text-sm font-bold text-white shadow">
                    开通会员
                  </Link>
                ) : (
                  <div className="space-y-2">
                    <Link href="/login" className="inline-block rounded-full bg-pink-500 px-6 py-2 text-sm font-bold text-white">
                      立即登录
                    </Link>
                    <p className="text-xs text-gray-500">还没有账号？<Link href="/register" className="text-pink-500">立即注册</Link></p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
