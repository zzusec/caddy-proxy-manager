#!/bin/bash
#
# uninstall.sh - 卸载脚本
#

set -e

echo "🗑️  Caddy Proxy Manager 卸载工具"
echo ""

# 检查是否安装
if ! docker ps -a | grep -q caddy-proxy-manager 2>/dev/null; then
    echo "ℹ️  未检测到已安装的 Caddy Proxy Manager"
    exit 0
fi

echo "⚠️  警告: 此操作将删除以下内容:"
echo "  - Docker 容器"
echo "  - Docker 镜像"
echo "  - Docker volumes (数据库、SSL 证书、配置文件)"
echo ""

read -p "是否继续? [y/N]: " confirm
if [[ ${confirm,,} != "y" ]]; then
    echo "❌ 已取消"
    exit 0
fi

echo ""
echo "🔄 开始卸载..."

# 停止并删除容器
echo "📦 停止容器..."
docker-compose down 2>/dev/null || docker stop caddy-proxy-manager 2>/dev/null || true

# 删除容器
echo "🗑️  删除容器..."
docker rm -f caddy-proxy-manager 2>/dev/null || true

# 询问是否删除数据
echo ""
read -p "是否删除所有数据 (数据库、SSL 证书)? [y/N]: " delete_data
if [[ ${delete_data,,} == "y" ]]; then
    echo "🗑️  删除 volumes..."
    docker-compose down -v 2>/dev/null || true
    docker volume rm caddy-proxy-manager_caddy_data 2>/dev/null || true
    docker volume rm caddy-proxy-manager_caddy_config 2>/dev/null || true
    docker volume rm caddy-proxy-manager_caddy_logs 2>/dev/null || true
    rm -rf ./data 2>/dev/null || true
    echo "✅ 数据已删除"
else
    echo "ℹ️  保留数据，下次安装可继续使用"
fi

# 询问是否删除镜像
echo ""
read -p "是否删除 Docker 镜像? [y/N]: " delete_image
if [[ ${delete_image,,} == "y" ]]; then
    echo "🗑️  删除镜像..."
    docker rmi caddy-proxy-manager-caddy-proxy-manager 2>/dev/null || true
    docker rmi caddy-proxy-manager_caddy-proxy-manager 2>/dev/null || true
    echo "✅ 镜像已删除"
fi

echo ""
echo "✅ 卸载完成！"
echo ""
echo "💡 提示:"
echo "  - 项目文件仍保留在当前目录"
echo "  - 如需完全删除，请手动删除项目目录"
echo "  - 重新安装: bash quick-start.sh"
