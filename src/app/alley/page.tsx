// 小巷子信息列表页
// 服务端取数据 + 当前用户，交给客户端组件 AlleyBrowser 做省份/城市筛选与展示。
// 图片模糊、位置隐藏，仅会员可看清/可见。

import { getAllAlleys } from "@/lib/alleys";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember } from "@/lib/membership";
import { AlleyBrowser } from "./AlleyBrowser";

export default async function AlleyListPage() {
  const raw = await getAllAlleys();
  const user = await getCurrentUser();
  const isMember = isActiveMember(user);
  // 具体位置仅会员可见：非会员直接不下发该字段，避免随源码泄露
  const alleys = isMember ? raw : raw.map((a) => ({ ...a, location: "" }));
  return <AlleyBrowser alleys={alleys} isMember={isMember} />;
}
