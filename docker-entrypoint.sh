#!/bin/bash
set -e

echo "🚀 启动 Caddy Proxy Manager..."

# 启动 Caddy (后台运行)
echo "📦 启动 Caddy 服务..."
caddy start --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true

# 等待 Caddy 启动
sleep 2

# 启动 Node.js 后端
echo "🌐 启动 Web 服务..."
exec node server/index.js
