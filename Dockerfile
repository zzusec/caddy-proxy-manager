FROM node:18-alpine

# 安装必要工具
RUN apk add --no-cache \
    bash \
    curl \
    openssl \
    jq \
    ca-certificates

# 安装 Caddy
RUN wget -qO /usr/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64" \
    && chmod +x /usr/bin/caddy

# 创建工作目录
WORKDIR /app

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm install --production

# 复制项目文件
COPY . .

# 复制 cpm.sh 到 /etc/caddy
RUN mkdir -p /etc/caddy /etc/caddy/sites /etc/caddy/cpm-meta /var/lib/caddy /var/log/caddy
COPY cpm.sh /etc/caddy/cpm.sh
RUN chmod +x /etc/caddy/cpm.sh

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3000 80 443

# 启动脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
