# Caddy Proxy Manager - Docker 部署指南

基于 Docker 的 Caddy 反向代理管理系统，一键部署，开箱即用。

## 快速开始

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- 服务器 80/443/3000 端口未被占用
- 域名已解析到服务器 IP

### 一键部署

```bash
# 1. 克隆或上传项目
git clone <your-repo> caddy-proxy-manager
cd caddy-proxy-manager

# 2. 启动容器
docker-compose up -d

# 3. 查看日志
docker-compose logs -f
```

访问 `http://your-server-ip:3000`，使用 `admin/admin` 登录。

## Docker 命令

### 启动服务
```bash
docker-compose up -d
```

### 停止服务
```bash
docker-compose down
```

### 重启服务
```bash
docker-compose restart
```

### 查看日志
```bash
# 实时日志
docker-compose logs -f

# 查看最近 100 行
docker-compose logs --tail=100
```

### 进入容器
```bash
docker-compose exec caddy-proxy-manager bash
```

### 重新构建
```bash
docker-compose build --no-cache
docker-compose up -d
```

## 端口映射

| 容器端口 | 宿主机端口 | 说明 |
|---------|-----------|------|
| 3000 | 3000 | Web 管理界面 |
| 80 | 80 | HTTP (SSL 证书申请) |
| 443 | 443 | HTTPS (代理服务) |

## 数据持久化

所有数据通过 Docker volumes 持久化：

```yaml
volumes:
  - ./data:/app/data              # SQLite 数据库
  - caddy_data:/var/lib/caddy     # SSL 证书
  - caddy_config:/etc/caddy       # Caddy 配置
  - caddy_logs:/var/log/caddy     # 日志文件
```

### 备份数据

```bash
# 备份数据库
docker cp caddy-proxy-manager:/app/data/cpm.db ./backup/

# 备份 SSL 证书
docker run --rm -v caddy-proxy-manager_caddy_data:/data -v $(pwd)/backup:/backup alpine tar czf /backup/caddy_data.tar.gz -C /data .

# 备份配置
docker run --rm -v caddy-proxy-manager_caddy_config:/config -v $(pwd)/backup:/backup alpine tar czf /backup/caddy_config.tar.gz -C /config .
```

### 恢复数据

```bash
# 恢复数据库
docker cp ./backup/cpm.db caddy-proxy-manager:/app/data/

# 恢复 SSL 证书
docker run --rm -v caddy-proxy-manager_caddy_data:/data -v $(pwd)/backup:/backup alpine tar xzf /backup/caddy_data.tar.gz -C /data

# 恢复配置
docker run --rm -v caddy-proxy-manager_caddy_config:/config -v $(pwd)/backup:/backup alpine tar xzf /backup/caddy_config.tar.gz -C /config
```

## 环境变量

在 `docker-compose.yml` 中配置：

```yaml
environment:
  - NODE_ENV=production
  - TZ=Asia/Shanghai           # 时区
  - SESSION_SECRET=your-secret # Session 密钥（可选）
```

## 自定义配置

### 修改端口

编辑 `docker-compose.yml`：

```yaml
ports:
  - "8080:3000"   # 将 Web 界面改为 8080 端口
  - "80:80"
  - "443:443"
```

### 使用外部数据库

如果需要使用 MySQL/PostgreSQL 替代 SQLite，修改 `server/index.js` 并添加数据库容器到 `docker-compose.yml`。

## 网络配置

### 反向代理到子路径

如果需要通过 Nginx 反代到子路径（如 `/cpm`）：

```nginx
location /cpm/ {
    proxy_pass http://localhost:3000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
}
```

### 使用 Caddy 反代管理界面

```caddyfile
cpm.example.com {
    reverse_proxy localhost:3000
}
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker-compose logs

# 检查端口占用
netstat -tlnp | grep -E '80|443|3000'

# 重新构建
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Caddy 服务异常

```bash
# 进入容器
docker-compose exec caddy-proxy-manager bash

# 检查 Caddy 状态
caddy version
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# 手动重启 Caddy
caddy stop
caddy start --config /etc/caddy/Caddyfile --adapter caddyfile
```

### SSL 证书申请失败

1. 确认域名已正确解析到服务器 IP
2. 确认 80 端口可从公网访问
3. 查看 Caddy 日志：`docker-compose logs | grep -i acme`

### 数据库权限问题

```bash
# 修复权限
docker-compose exec caddy-proxy-manager chown -R node:node /app/data
docker-compose restart
```

## 更新升级

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 生产环境建议

1. **修改默认密码**: 首次登录后立即修改
2. **配置 HTTPS**: 为管理界面配置 SSL 证书
3. **限制访问**: 使用防火墙限制 3000 端口访问
4. **定期备份**: 设置 cron 定时备份数据库和证书
5. **监控日志**: 使用 `docker-compose logs -f` 监控异常
6. **资源限制**: 在 `docker-compose.yml` 中添加资源限制

```yaml
services:
  caddy-proxy-manager:
    # ...
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## 卸载

```bash
# 停止并删除容器
docker-compose down

# 删除 volumes（⚠️ 会删除所有数据）
docker-compose down -v

# 删除镜像
docker rmi caddy-proxy-manager_caddy-proxy-manager
```

## 技术栈

- **基础镜像**: node:18-alpine
- **Web 服务**: Express + SQLite
- **代理服务**: Caddy 2.x
- **容器编排**: Docker Compose

## 支持

- 问题反馈: GitHub Issues
- 文档: README.md
- 日志: `docker-compose logs -f`
