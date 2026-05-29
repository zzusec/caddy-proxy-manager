# Caddy Proxy Manager

<div align="center">

**基于 Web 的 Caddy 反向代理管理系统**

支持 VMess/VLESS/Trojan/Shadowsocks 协议的 ws/grpc/httpupgrade 传输层反代到 443/TLS

[快速开始](#快速开始) • [功能特性](#功能特性) • [Docker 部署](#docker-部署) • [文档](#文档)

</div>

---

## 快速开始

### 🐳 Docker 一键部署（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/zzusec/caddy-proxy-manager.git
cd caddy-proxy-manager

# 2. 一键启动
bash quick-start.sh

# 3. 访问管理界面
# http://your-server-ip:3000
# 用户名: admin  密码: admin
```

就这么简单！🎉

---

## 功能特性

### 核心功能

- ✅ **完整的登录认证系统** - 基于 session + bcrypt 加密
- ✅ **代理服务管理** - 添加/删除/列表，一键操作
- ✅ **多协议支持** - VMess、VLESS、Trojan、Shadowsocks
- ✅ **多传输层支持** - WebSocket、gRPC、HTTPUpgrade
- ✅ **SSL 自动化** - Caddy 自动申请和更新 Let's Encrypt 证书
- ✅ **实时状态监控** - 在线状态、证书状态、系统监控
- ✅ **日志查看** - 系统日志 + Caddy 日志
- ✅ **响应式界面** - 参考 Nginx Proxy Manager 设计风格

### 支持的协议矩阵

| 协议 | 传输层 | 状态 |
|---|---|---|
| VMess | ws / grpc / httpupgrade | ✅ |
| VLESS | ws / grpc / httpupgrade | ✅ |
| Trojan | ws / grpc | ✅ |
| Shadowsocks + v2ray-plugin | ws | ✅ |

---

## Docker 部署

### 系统要求

- Docker 20.10+
- Docker Compose 2.0+
- 端口 80/443/3000 未被占用
- 域名已解析到服务器 IP

### 部署步骤

#### 方式 1: 自动安装（最简单）

```bash
# 下载项目
git clone https://github.com/zzusec/caddy-proxy-manager.git
cd caddy-proxy-manager

# 一键启动（自动检测并安装 Docker）
bash quick-start.sh
```

#### 方式 2: 手动安装 Docker

```bash
# 1. 安装 Docker（如果未安装）
bash install-docker.sh

# 2. 启动服务
docker-compose up -d

# 3. 查看日志
docker-compose logs -f
```

### Docker 常用命令

```bash
# 启动
docker-compose up -d

# 停止
docker-compose down

# 重启
docker-compose restart

# 查看日志
docker-compose logs -f

# 进入容器
docker-compose exec caddy-proxy-manager bash

# 重新构建
docker-compose build --no-cache
docker-compose up -d
```

### 端口说明

| 端口 | 说明 |
|-----|------|
| 3000 | Web 管理界面 |
| 80 | HTTP (用于 SSL 证书申请) |
| 443 | HTTPS (代理服务) |

### 数据持久化

所有数据通过 Docker volumes 持久化：

- `./data` - SQLite 数据库
- `caddy_data` - SSL 证书
- `caddy_config` - Caddy 配置文件
- `caddy_logs` - 日志文件

---

## 传统部署

如果不使用 Docker，可以传统方式部署：

### 1. 安装 cpm.sh 脚本

```bash
scp cpm.sh root@your-server:/etc/caddy/cpm.sh
ssh root@your-server
chmod +x /etc/caddy/cpm.sh
```

### 2. 安装 Web 系统

```bash
cd /opt
git clone https://github.com/zzusec/caddy-proxy-manager.git
cd caddy-proxy-manager

npm install
npm run build
npm run server
```

### 3. 使用 PM2 守护进程

```bash
npm install -g pm2
pm2 start server/index.js --name cpm
pm2 save
pm2 startup
```

---

## 使用说明

### 默认登录信息

- **用户名**: `admin`
- **密码**: `admin`

⚠️ **首次登录后请立即修改密码！**

### 添加代理服务

1. 登录管理面板
2. 点击「代理服务列表」
3. 点击「+ 添加代理服务」
4. 填写信息：
   - **代理链接**: 粘贴 `vmess://` / `vless://` / `trojan://` / `ss://` 链接
   - **域名**: 输入已解析到本机的域名
   - **邮箱**: 用于 Let's Encrypt 证书申请（可选）
5. 点击「添加」

系统会自动：
- 生成 Caddy 配置
- 申请 SSL 证书
- 重载 Caddy 服务
- 生成新的 443/TLS 链接

### 查看代理列表

代理列表显示：
- 来源域名
- 目标服务器地址
- 协议类型（VMess/VLESS/Trojan/SS）
- 传输层（ws/grpc/httpupgrade）
- SSL 状态
- 在线状态
- 创建时间

### 删除代理

点击操作列的「删除」按钮，确认后自动删除配置并重载服务。

---

## 文档

- [Docker 部署详细文档](./DOCKER.md)
- [API 接口文档](#api-接口)
- [故障排查](#故障排查)

---

## 目录结构

```
caddy-proxy-manager/
├── server/
│   └── index.js              # Express 后端
├── src/
│   └── main.js               # 前端 JS
├── data/
│   └── cpm.db                # SQLite 数据库
├── index.html                # 前端入口
├── cpm.sh                    # Caddy 代理管理脚本
├── Dockerfile                # Docker 镜像
├── docker-compose.yml        # Docker Compose 配置
├── docker-entrypoint.sh      # 容器启动脚本
├── quick-start.sh            # 快速启动脚本
├── install-docker.sh         # Docker 安装脚本
├── deploy.sh                 # 传统部署脚本
├── package.json
├── vite.config.js
├── README.md
└── DOCKER.md
```

---

## API 接口

### 认证
- `POST /api/login` - 登录
- `POST /api/logout` - 登出
- `GET /api/me` - 获取当前用户

### 代理管理
- `GET /api/proxies` - 获取代理列表
- `POST /api/proxies` - 添加代理
- `DELETE /api/proxies/:domain` - 删除代理

### SSL 证书
- `GET /api/ssl/:domain` - 查看证书状态

### 日志
- `GET /api/logs` - 系统日志
- `GET /api/logs/caddy` - Caddy 日志

### 系统状态
- `GET /api/status` - 系统状态

---

## 故障排查

### Docker 容器无法启动

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
caddy validate --config /etc/caddy/Caddyfile

# 查看日志
docker-compose logs | grep caddy
```

### SSL 证书申请失败

1. 确认域名已正确解析到服务器 IP
2. 确认 80 端口可从公网访问
3. 查看 Caddy 日志：`docker-compose logs | grep -i acme`

### 数据备份

```bash
# 备份数据库
docker cp caddy-proxy-manager:/app/data/cpm.db ./backup/

# 备份 SSL 证书
docker run --rm -v caddy-proxy-manager_caddy_data:/data \
  -v $(pwd)/backup:/backup alpine \
  tar czf /backup/caddy_data.tar.gz -C /data .
```

---

## 安全建议

1. ✅ **修改默认密码** - 首次登录后立即修改
2. ✅ **使用 HTTPS** - 为管理界面配置 SSL 证书
3. ✅ **限制访问** - 使用防火墙限制 3000 端口访问
4. ✅ **定期备份** - 备份数据库和证书
5. ✅ **更新依赖** - 定期更新 Docker 镜像

---

## 技术栈

- **后端**: Node.js + Express + SQLite + bcryptjs
- **前端**: Vanilla JavaScript + Vite
- **代理**: Caddy 2.x
- **容器**: Docker + Docker Compose
- **基础镜像**: node:18-alpine

---

## 开发模式

```bash
# 终端 1: 启动后端
npm run server

# 终端 2: 启动前端开发服务器
npm run dev
```

访问 http://localhost:5173

---

## License

MIT

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

<div align="center">

**Made with ❤️ for the community**

</div>
