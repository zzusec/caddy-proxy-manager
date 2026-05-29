#!/bin/bash
set -e

echo "🚀 启动 Caddy Proxy Manager..."

# 准备目录
mkdir -p /etc/caddy/sites /etc/caddy/cpm-meta /var/lib/caddy /var/log/caddy

# 初始化 Caddyfile（如果不存在）
if [[ ! -f /etc/caddy/Caddyfile ]]; then
    cat > /etc/caddy/Caddyfile <<EOF
# 由 cpm.sh 生成
{
    email admin@example.com
    admin off
}
import /etc/caddy/sites/*.caddy
EOF
fi

# 检查是否有已配置的代理服务（决定是否启动 Caddy）
SITE_COUNT=$(find /etc/caddy/sites -name "*.caddy" 2>/dev/null | wc -l)

if [[ $SITE_COUNT -gt 0 ]]; then
    echo "📦 检测到 $SITE_COUNT 个代理服务，启动 Caddy..."
    caddy start --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true
    sleep 2
else
    echo "ℹ️  无代理服务配置，Caddy 暂不启动（节省端口）"
fi

# 启动 Node.js 后端
echo "🌐 启动 Web 服务..."
exec node server/index.js
