import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// 数据库初始化
const dbPath = join(__dirname, '../data/cpm.db');
const dataDir = join(__dirname, '../data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    proto TEXT NOT NULL,
    net TEXT NOT NULL,
    upstream TEXT NOT NULL,
    path TEXT NOT NULL,
    ps TEXT,
    email TEXT,
    ssl_status TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'online',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 创建默认管理员 (admin/admin)
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashedPassword);
}

// 中间件
app.use(cors({
  origin: true,  // 允许所有来源（生产环境应该限制）
  credentials: true
}));
app.use(bodyParser.json());
app.use(session({
  secret: 'cpm-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 提供静态文件（生产环境）
app.use(express.static(join(__dirname, '../dist')));
app.use(express.static(join(__dirname, '..')));

// 认证中间件
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

// ========== 认证接口 ==========
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username });
});

// ========== 代理管理接口 ==========
app.get('/api/proxies', requireAuth, (req, res) => {
  const proxies = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all();
  res.json(proxies);
});

app.post('/api/proxies', requireAuth, async (req, res) => {
  const { link, domain, email } = req.body;

  try {
    // 调用 cpm.sh 脚本添加代理
    const cpmScript = '/etc/caddy/cpm.sh';
    const { stdout, stderr } = await execAsync(
      `echo "${link}\n${domain}\n${email || ''}\n" | bash ${cpmScript} add`,
      { shell: '/bin/bash' }
    );

    // 解析输出获取代理信息
    const metaPath = `/etc/caddy/cpm-meta/${domain}.json`;
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));

      db.prepare(`
        INSERT INTO proxies (domain, proto, net, upstream, path, ps, email, ssl_status, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'online')
      `).run(meta.domain, meta.proto, meta.net, meta.upstream, meta.path, meta.ps || '', email || '');

      db.prepare('INSERT INTO logs (type, message) VALUES (?, ?)').run('info', `添加代理: ${domain}`);

      res.json({ success: true, message: '代理添加成功' });
    } else {
      throw new Error('代理配置文件未生成');
    }
  } catch (error) {
    db.prepare('INSERT INTO logs (type, message) VALUES (?, ?)').run('error', `添加代理失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/proxies/:domain', requireAuth, async (req, res) => {
  const { domain } = req.params;

  try {
    const cpmScript = '/etc/caddy/cpm.sh';
    await execAsync(`bash ${cpmScript} del ${domain}`);

    db.prepare('DELETE FROM proxies WHERE domain = ?').run(domain);
    db.prepare('INSERT INTO logs (type, message) VALUES (?, ?)').run('info', `删除代理: ${domain}`);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== SSL 证书管理 ==========
app.get('/api/ssl/:domain', requireAuth, async (req, res) => {
  const { domain } = req.params;

  try {
    const certPath = `/var/lib/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${domain}/${domain}.crt`;

    if (existsSync(certPath)) {
      const { stdout } = await execAsync(`openssl x509 -in ${certPath} -noout -dates`);
      res.json({ status: 'active', info: stdout });
    } else {
      res.json({ status: 'pending', info: '证书申请中或未配置' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 日志接口 ==========
app.get('/api/logs', requireAuth, (req, res) => {
  const logs = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 100').all();
  res.json(logs);
});

app.get('/api/logs/caddy', requireAuth, async (req, res) => {
  try {
    const { stdout } = await execAsync('journalctl -u caddy -n 100 --no-pager');
    res.json({ logs: stdout });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 系统状态 ==========
app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const { stdout: caddyStatus } = await execAsync('systemctl is-active caddy');
    const proxyCount = db.prepare('SELECT COUNT(*) as count FROM proxies').get();

    res.json({
      caddy: caddyStatus.trim(),
      proxyCount: proxyCount.count,
      uptime: process.uptime()
    });
  } catch (error) {
    res.json({ caddy: 'inactive', proxyCount: 0, uptime: 0 });
  }
});

// ========== 前端路由 (SPA fallback) ==========
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Caddy Proxy Manager 后端运行在 http://localhost:${PORT}`);
});
