#!/bin/bash
set -e

echo "=========================================="
echo "找老师网站 - 服务器部署脚本"
echo "=========================================="
echo ""

APP_DIR="/opt/hulim"
APP_PORT="3000"

# 1. 更新系统
echo "1️⃣  更新系统..."
apt-get update -qq > /dev/null 2>&1
apt-get install -y -qq curl git build-essential > /dev/null 2>&1
echo "   ✓ 系统已更新"

# 2. 安装 Node.js
echo "2️⃣  安装 Node.js..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  echo "   ✓ Node.js 已安装 ($(node -v))"
else
  echo "   ✓ Node.js 已存在 ($(node -v))"
fi

# 3. 克隆代码
echo "3️⃣  克隆代码..."
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  git pull origin main > /dev/null 2>&1
  echo "   ✓ 代码已更新"
else
  mkdir -p "$APP_DIR"
  git clone https://github.com/nanfang667-coder/xiao.git "$APP_DIR" > /dev/null 2>&1
  echo "   ✓ 代码已克隆"
fi

cd "$APP_DIR"

# 4. 安装依赖
echo "4️⃣  安装依赖..."
npm install --production --silent > /dev/null 2>&1
echo "   ✓ npm 依赖已安装"

# 5. 配置环境变量
echo "5️⃣  配置环境变量..."
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_SESSION_SECRET=$(openssl rand -base64 32)

cat > .env << EOF
DATABASE_URL="file:./prisma/prod.db"
ADMIN_PASSWORD="admin888"
ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET"
JWT_SECRET="$JWT_SECRET"
WITHDRAWALS_ENABLED="false"
EOF
echo "   ✓ .env 已配置（使用随机密钥）"

# 6. 初始化数据库
echo "6️⃣  初始化数据库..."
npx prisma migrate deploy > /dev/null 2>&1
npx prisma db seed > /dev/null 2>&1
echo "   ✓ 数据库已初始化"

# 7. 构建
echo "7️⃣  构建生产版本..."
npm run build > /dev/null 2>&1
echo "   ✓ 构建完成"

# 8. 安装 PM2
echo "8️⃣  安装 PM2..."
npm install -g pm2 > /dev/null 2>&1
echo "   ✓ PM2 已安装"

# 9. 启动应用
echo "9️⃣  启动应用..."
pm2 stop hulim 2>/dev/null || true
pm2 delete hulim 2>/dev/null || true
pm2 start "npm start" --name hulim --cwd "$APP_DIR" > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1
echo "   ✓ 应用已启动"

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "📍 应用信息："
echo "   - 目录: $APP_DIR"
echo "   - 端口: $APP_PORT (localhost:3000)"
echo "   - 数据库: $APP_DIR/prisma/prod.db"
echo "   - 管理员: /admin/login (密码: admin888)"
echo ""
echo "🔧 常用命令："
echo "   pm2 logs hulim           # 查看日志"
echo "   pm2 status hulim         # 查看状态"
echo "   pm2 restart hulim        # 重启应用"
echo "   pm2 stop hulim           # 停止应用"
echo ""
echo "⚠️  重要提醒："
echo "   1. 修改 .env 中的 ADMIN_PASSWORD（当前是默认 admin888）"
echo "   2. 配置 Nginx 反向代理（80/443 → localhost:3000）"
echo "   3. 配置 SSL 证书（Let's Encrypt）"
echo "   4. DNS 解析 gp77.top 到此服务器 IP"
echo "   5. 支付接入后，改 .env 的 WITHDRAWALS_ENABLED=\"true\""
echo ""
