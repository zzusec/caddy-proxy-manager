#!/bin/bash
#
# quick-start.sh - 快速启动脚本
#

set -e

echo "🚀 Caddy Proxy Manager 快速启动"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 未检测到 Docker"
    read -p "是否自动安装 Docker? [y/N]: " install_docker
    if [[ ${install_docker,,} == "y" ]]; then
        bash install-docker.sh
    else
        echo "请先安装 Docker: https://docs.docker.com/engine/install/"
        exit 1
    fi
fi

# 检查 docker-compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ 未检测到 docker-compose"
    exit 1
fi

# 检查端口占用
check_port() {
    if netstat -tuln 2>/dev/null | grep -q ":$1 "; then
        echo "⚠️  警告: 端口 $1 已被占用"
        return 1
    fi
    return 0
}

echo "🔍 检查端口占用..."
ports_ok=true
for port in 80 443 3000; do
    if ! check_port $port; then
        ports_ok=false
    fi
done

if [[ $ports_ok == false ]]; then
    read -p "是否继续? [y/N]: " continue
    [[ ${continue,,} != "y" ]] && exit 1
fi

# 创建数据目录
mkdir -p data

# 启动容器
echo ""
echo "🐳 启动 Docker 容器..."
docker-compose up -d

# 等待服务启动
echo ""
echo "⏳ 等待服务启动..."
sleep 5

# 检查容器状态
if docker-compose ps | grep -q "Up"; then
    echo ""
    echo "✅ 启动成功！"
    echo ""
    echo "📝 访问信息:"
    echo "   地址: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):3000"
    echo "   用户名: admin"
    echo "   密码: admin"
    echo ""
    echo "📋 常用命令:"
    echo "   查看日志: docker-compose logs -f"
    echo "   重启服务: docker-compose restart"
    echo "   停止服务: docker-compose down"
    echo ""
    echo "⚠️  安全提示: 首次登录后请立即修改密码！"
else
    echo ""
    echo "❌ 启动失败，请查看日志:"
    echo "   docker-compose logs"
    exit 1
fi
