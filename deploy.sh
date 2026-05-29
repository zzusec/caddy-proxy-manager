#!/bin/bash
#
# deploy.sh - 一键部署脚本
#

set -e

echo "🚀 开始部署 Caddy Proxy Manager..."

# 检查 root 权限
if [[ $EUID -ne 0 ]]; then
   echo "❌ 请使用 root 用户运行此脚本"
   exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "📦 安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

echo "✅ Node.js 版本: $(node -v)"

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 安装 PM2..."
    npm install -g pm2
fi

# 安装依赖
echo "📦 安装项目依赖..."
npm install

# 构建前端
echo "🔨 构建前端..."
npm run build

# 复制 cpm.sh 到 /etc/caddy
if [[ -f "../Downloads/cpm.sh" ]]; then
    echo "📋 复制 cpm.sh 到 /etc/caddy..."
    mkdir -p /etc/caddy
    cp ../Downloads/cpm.sh /etc/caddy/cpm.sh
    chmod +x /etc/caddy/cpm.sh
elif [[ ! -f "/etc/caddy/cpm.sh" ]]; then
    echo "⚠️  警告: 未找到 cpm.sh，请手动复制到 /etc/caddy/cpm.sh"
fi

# 启动服务
echo "🚀 启动服务..."
pm2 delete cpm 2>/dev/null || true
pm2 start server/index.js --name cpm
pm2 save
pm2 startup

echo ""
echo "✅ 部署完成！"
echo ""
echo "📝 访问信息:"
echo "   地址: http://$(hostname -I | awk '{print $1}'):3000"
echo "   用户名: admin"
echo "   密码: admin"
echo ""
echo "📋 常用命令:"
echo "   查看日志: pm2 logs cpm"
echo "   重启服务: pm2 restart cpm"
echo "   停止服务: pm2 stop cpm"
echo ""
echo "⚠️  安全提示: 首次登录后请立即修改密码！"
