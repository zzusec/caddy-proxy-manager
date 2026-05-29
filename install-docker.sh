#!/bin/bash
#
# install-docker.sh - Docker 一键安装脚本
#

set -e

echo "🐳 开始安装 Docker 和 Docker Compose..."

# 检查是否已安装
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "✅ Docker 已安装"
    docker --version
    docker-compose --version
    exit 0
fi

# 检测系统
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ 无法检测系统类型"
    exit 1
fi

# 安装 Docker
case $OS in
    ubuntu|debian)
        echo "📦 在 Ubuntu/Debian 上安装 Docker..."
        apt-get update
        apt-get install -y ca-certificates curl gnupg lsb-release

        # 添加 Docker 官方 GPG key
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

        # 添加 Docker 仓库
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
          $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

        # 安装 Docker Engine
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        ;;

    centos|rhel)
        echo "📦 在 CentOS/RHEL 上安装 Docker..."
        yum install -y yum-utils
        yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        systemctl start docker
        systemctl enable docker
        ;;

    *)
        echo "❌ 不支持的系统: $OS"
        exit 1
        ;;
esac

# 安装 docker-compose (standalone)
if ! command -v docker-compose &> /dev/null; then
    echo "📦 安装 docker-compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# 启动 Docker
systemctl start docker
systemctl enable docker

# 验证安装
echo ""
echo "✅ Docker 安装完成！"
docker --version
docker-compose --version

echo ""
echo "🎉 现在可以运行: docker-compose up -d"
