// 种子脚本：把初始的 10 位老师写进数据库。
// 运行方式：node prisma/seed.mjs
// （以后有了后台管理，就用后台加老师，不用这个脚本了）

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const teachers = [
  {
    name: "李老师 · 古典钢琴一对一",
    type: "钢琴",
    city: "上海",
    district: "徐汇区",
    price: "¥300 / 课时",
    services:
      "上海音乐学院毕业，10 年教龄。擅长儿童启蒙与成人零基础教学，可考级辅导（英皇/上音）。",
    photos: ["from-indigo-400 to-purple-500", "from-purple-400 to-pink-500", "from-blue-400 to-indigo-500"],
    emoji: "🎹",
    phone: "138-0000-0001",
    wechat: "piano_li_sh",
  },
  {
    name: "王老师 · 少儿中国舞",
    type: "舞蹈",
    city: "上海",
    district: "浦东新区",
    price: "¥260 / 课时",
    services:
      "北京舞蹈学院科班出身，专注 4-12 岁少儿中国舞、民族舞。小班教学，含考级与演出编排。",
    photos: ["from-rose-400 to-pink-500", "from-pink-400 to-fuchsia-500", "from-red-400 to-rose-500"],
    emoji: "💃",
    phone: "138-0000-0002",
    wechat: "dance_wang_sh",
  },
  {
    name: "陈老师 · 成人流行钢琴速成",
    type: "钢琴",
    city: "上海",
    district: "静安区",
    price: "¥220 / 课时",
    services:
      "专为上班族设计，流行歌曲即兴伴奏、看谱弹唱，3 个月能弹整首曲子。可上门或线上。",
    photos: ["from-sky-400 to-blue-500", "from-cyan-400 to-sky-500", "from-blue-400 to-indigo-500"],
    emoji: "🎹",
    phone: "138-0000-0003",
    wechat: "piano_chen_sh",
  },
  {
    name: "孙老师 · 芭蕾形体",
    type: "舞蹈",
    city: "上海",
    district: "黄浦区",
    price: "¥300 / 课时",
    services:
      "英皇芭蕾认证教师，注重形体气质培养。适合零基础成人与少儿，改善体态、提升气质。",
    photos: ["from-fuchsia-400 to-violet-500", "from-violet-400 to-purple-500", "from-pink-400 to-fuchsia-500"],
    emoji: "💃",
    phone: "138-0000-0004",
    wechat: "dance_sun_sh",
  },
  {
    name: "周老师 · 钢琴考级专项",
    type: "钢琴",
    city: "上海",
    district: "长宁区",
    price: "¥350 / 课时",
    services:
      "专攻钢琴考级冲刺，学生通过率高。针对乐理、视奏、演奏三方面系统训练，包含模拟考。",
    photos: ["from-teal-400 to-emerald-500", "from-emerald-400 to-green-500", "from-cyan-400 to-teal-500"],
    emoji: "🎹",
    phone: "138-0000-0005",
    wechat: "piano_zhou_sh",
  },
  {
    name: "赵老师 · 拉丁舞 / 爵士舞",
    type: "舞蹈",
    city: "北京",
    district: "朝阳区",
    price: "¥280 / 课时",
    services:
      "多次拉丁舞比赛冠军，教学风格活泼。适合青少年与成人塑形，零基础可学，提供试课。",
    photos: ["from-amber-400 to-orange-500", "from-orange-400 to-red-500", "from-yellow-400 to-amber-500"],
    emoji: "💃",
    phone: "138-0000-0006",
    wechat: "dance_zhao_bj",
  },
  {
    name: "吴老师 · 儿童钢琴启蒙",
    type: "钢琴",
    city: "北京",
    district: "海淀区",
    price: "¥320 / 课时",
    services:
      "中央音乐学院毕业，专注 3-8 岁钢琴启蒙，趣味教学，激发孩子兴趣，家长陪课指导。",
    photos: ["from-indigo-400 to-blue-500", "from-blue-400 to-sky-500", "from-violet-400 to-indigo-500"],
    emoji: "🎹",
    phone: "138-0000-0007",
    wechat: "piano_wu_bj",
  },
  {
    name: "郑老师 · 街舞 / 少儿街舞",
    type: "舞蹈",
    city: "广州",
    district: "天河区",
    price: "¥240 / 课时",
    services:
      "专业街舞教练，Hiphop / Breaking 均可教。适合青少年，锻炼协调性与自信心。",
    photos: ["from-rose-400 to-red-500", "from-red-400 to-orange-500", "from-pink-400 to-rose-500"],
    emoji: "💃",
    phone: "138-0000-0008",
    wechat: "dance_zheng_gz",
  },
  {
    name: "冯老师 · 成人钢琴陪练",
    type: "钢琴",
    city: "成都",
    district: "锦江区",
    price: "¥180 / 课时",
    services:
      "耐心细致，专注成人零基础与复学人群。灵活约课，可线上陪练，进度个性化定制。",
    photos: ["from-cyan-400 to-sky-500", "from-sky-400 to-blue-500", "from-teal-400 to-cyan-500"],
    emoji: "🎹",
    phone: "138-0000-0009",
    wechat: "piano_feng_cd",
  },
  {
    name: "何老师 · 现代舞 / 编舞",
    type: "舞蹈",
    city: "深圳",
    district: "南山区",
    price: "¥300 / 课时",
    services:
      "现代舞专业，擅长编舞与舞台表演。适合有一定基础想进阶的学员，也收零基础成人。",
    photos: ["from-violet-400 to-purple-500", "from-purple-400 to-fuchsia-500", "from-indigo-400 to-violet-500"],
    emoji: "💃",
    phone: "138-0000-0010",
    wechat: "dance_he_sz",
  },
];

async function main() {
  // 先清空旧数据，避免重复灌入
  await prisma.teacher.deleteMany();

  for (const t of teachers) {
    await prisma.teacher.create({
      data: {
        name: t.name,
        type: t.type,
        city: t.city,
        district: t.district,
        price: t.price,
        services: t.services,
        photos: JSON.stringify(t.photos), // 数组转成 JSON 文本存进去
        emoji: t.emoji,
        phone: t.phone,
        wechat: t.wechat,
      },
    });
  }

  const count = await prisma.teacher.count();
  console.log(`✅ 已写入 ${count} 位老师`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
