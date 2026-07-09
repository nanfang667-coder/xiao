# Hulim - 钢琴/舞蹈老师信息展示平台

## 📋 项目概述
这是一个钢琴和舞蹈老师信息展示网站，提供老师信息浏览、用户注册登录、会员系统、后台管理等功能。用户可以浏览不同城市和区域的老师信息，会员可以查看老师的联系方式。

## 🛠️ 技术栈
- **前端框架**: Next.js 16.2.10 (App Router)
- **样式**: Tailwind CSS 4
- **数据库**: SQLite + Prisma 6.19.3 (ORM)
- **认证**: JWT + bcrypt
- **语言**: TypeScript
- **部署**: Vercel 兼容

## 🔧 环境配置
```bash
# 环境变量 (.env)
DATABASE_URL="file:./dev.db"           # SQLite 数据库路径
ADMIN_PASSWORD="admin888"              # 后台管理密码
ADMIN_SESSION_SECRET="..."             # 管理员会话密钥
JWT_SECRET="..."                       # JWT 签名密钥
```

## 🚀 运行方式
```bash
# 安装依赖
npm install

# 数据库初始化
npx prisma migrate dev
npx prisma db seed      # 可选：填充测试数据

# 开发模式
npm run dev

# 构建生产版本
npm run build
npm start

# 代码检查
npm run lint
```

## 📁 项目结构
```
hulim/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx           # 首页
│   │   ├── layout.tsx         # 根布局
│   │   ├── login/page.tsx     # 登录页
│   │   ├── register/page.tsx  # 注册页
│   │   ├── teacher/[id]/      # 老师详情页
│   │   ├── admin/             # 后台管理
│   │   │   ├── page.tsx       # 管理首页
│   │   │   ├── login/page.tsx # 管理员登录
│   │   │   ├── new/page.tsx   # 新增老师
│   │   │   └── [id]/edit/page.tsx # 编辑老师
│   │   └── TeacherBrowser.tsx # 老师浏览组件
│   ├── components/            # 共用组件
│   │   └── UserStatus.tsx     # 用户状态组件
│   ├── lib/                   # 工具函数
│   │   ├── prisma.ts         # 数据库连接
│   │   ├── teachers.ts       # 老师数据操作
│   │   ├── user-auth.ts      # 用户认证
│   │   ├── auth.ts           # 管理员认证
│   │   └── photo.ts          # 照片处理
│   ├── data/                 # 静态数据
│   │   └── locations.ts      # 城市区域数据
│   └── middleware.ts         # 中间件
├── prisma/                   # 数据库配置
│   ├── schema.prisma        # 数据模型
│   ├── dev.db              # SQLite 数据库
│   └── seed.mjs            # 种子数据
├── public/                  # 静态资源
└── package.json
```

## 🎯 核心功能
### 前台功能
1. **老师浏览**: 按城市、区域筛选老师信息
2. **老师详情**: 查看老师详细信息和服务内容
3. **用户系统**: 注册、登录、登出
4. **会员权限**: 仅会员可查看联系方式（电话、微信、QQ）
5. **响应式设计**: 适配移动端和桌面端

### 后台管理
1. **管理员登录**: `/admin/login`（密码见 `.env` 的 `ADMIN_PASSWORD`，不要把真实密码写进这份文档）
2. **老师管理**: 新增、编辑、删除老师信息
3. **数据管理**: 查看所有老师数据

### 认证系统
- **用户认证**: JWT + bcrypt，Cookie存储
- **会员系统**: isMember字段控制权限
- **管理员认证**: 独立的管理员密码系统

## 🗄️ 数据库模式
```prisma
model Teacher {
  id        Int      @id @default(autoincrement())
  name      String   // 老师姓名
  type      String   // "钢琴" 或 "舞蹈"
  city      String   // 城市
  district  String   // 区
  price     String   // 价格
  services  String   // 服务内容
  process   String?  // 过程介绍
  photos    String   // JSON数组存储照片
  emoji     String   // 图标 (🎹/💃)
  phone     String   // 联系电话
  wechat    String   // 微信
  qq        String?  // QQ
  createdAt DateTime @default(now())
}

model User {
  id        Int      @id @default(autoincrement())
  username  String   @unique  // 用户名
  email     String   @unique  // 邮箱
  passwordHash String         // 密码哈希
  isMember  Boolean  @default(false)  // 是否会员
  membershipExpiresAt DateTime?       // 会员到期时间
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 🔐 安全特性
1. **密码安全**: bcrypt哈希存储
2. **JWT认证**: HttpOnly Cookie防止XSS
3. **权限控制**: 会员/非会员区分
4. **管理员保护**: 独立认证系统
5. **输入验证**: 表单验证和SQL注入防护

## 🚨 注意事项
1. **Next.js版本**: 本项目使用Next.js 16.2.10，注意API和约定可能与你熟悉的版本不同
2. **图片上传**: 支持最大15MB图片上传（通过serverActions配置）
3. **数据库**: 使用SQLite开发，生产环境可切换至PostgreSQL
4. **环境变量**: JWT_SECRET在生产环境必须更换
5. **会员系统**: 目前会员标识简单，可按需扩展会员等级和支付系统

## 🔗 重要路由
- 首页: `/`
- 登录: `/login`
- 注册: `/register`
- 老师详情: `/teacher/[id]`
- 后台管理: `/admin` (重定向到`/admin/login`)
- 管理员登录: `/admin/login`

## 📝 开发说明
1. 修改数据模型后需运行 `npx prisma migrate dev`
2. 新增环境变量需更新`.env`和类型声明
3. 图片上传路径为`/uploads/`，需确保目录存在
4. 后台管理密码在`.env`的`ADMIN_PASSWORD`中配置

## ⚡ 快速开始
```bash
# 克隆项目后
cp .env.example .env  # 复制环境变量
npm install
npx prisma migrate dev
npx prisma db seed    # 可选：添加示例数据
npm run dev
```

---
*最后更新: 2026-07-06*
*项目状态: 运行中，功能完整*