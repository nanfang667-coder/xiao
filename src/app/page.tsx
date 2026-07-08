// 首页（server 组件）：负责从数据库读取老师，再交给下面的组件展示。
import { getTeachersForList } from "@/lib/teachers";
import { getCurrentUser } from "@/lib/user-auth";
import { TeacherBrowser } from "./TeacherBrowser";

export default async function Home() {
  // 用不含联系方式的列表数据，避免会员专属信息随源码泄露
  const teachers = await getTeachersForList();
  const user = await getCurrentUser(); // 获取当前登录用户

  return <TeacherBrowser teachers={teachers} user={user} />;
}
