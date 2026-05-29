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

app.post('/api/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请输入旧密码和新密码' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: '新密码长度至少 6 位' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(401).json({ error: '旧密码错误' });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);

  db.prepare('INSERT INTO logs (type, message) VALUES (?, ?)').run('info', `用户 ${user.username} 修改了密码`);

  res.json({ success: true, message: '密码修改成功' });
});

// ========== Caddy 进程管理 ==========
// 按需启动：有代理时启动 Caddy，无代理时停止 Caddy，释放 80/443 端口
const SITES_DIR = '/etc/caddy/sites';
const CADDYFILE = '/etc/caddy/Caddyfile';

async function isCaddyRunning() {
  try {
    const { stdout } = await execAsync('pgrep -x caddy || true');
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function getSiteCount() {
  try {
    if (!existsSync(SITES_DIR)) return 0;
    const files = readdirSync(SITES_DIR).filter(f => f.endsWith('.caddy'));
    return files.length;
  } catch {
    return 0;
  }
}

async function startCaddy() {
  const running = await isCaddyRunning();
  if (running) {
    // 已运行，reload 配置即可
    try {
      await execAsync(`caddy reload --config ${CADDYFILE} --adapter caddyfile`);
      console.log('🔄 Caddy 配置已重载');
    } catch (e) {
      console.error('❌ Caddy reload 失败:', e.message);
    }
    return;
  }
  // 未运行，启动
  try {
    await execAsync(`caddy start --config ${CADDYFILE} --adapter caddyfile`);
    console.log('🚀 Caddy 已启动 (监听 80/443)');
    db.prepare('INSERT INTO logs (type, message) VALUES (?, ?)').run('info', 'Caddy 已启动 (按需)');
  } catch (e) {
    console.error('❌ Caddy 启动失败:', e.message);
    throw e;
  }
}

async function stopCaddy() {
  const running = await isCaddyRunning();
  if (!running) return;
  try {
    await execAsync('caddy stop');
    console.log('🛑 Caddy 已停止 (释放 80/443)');
    db.prepare('INSERT INTO logs (type, message) VALUES (?, ?)').run('info', 'Caddy 已停止 (无代理服务)');
  } catch (e) {
    console.error('❌ Caddy 停止失败:', e.message);
  }
}

// ========== 代理管理接口 ==========
app.get('/api/proxies', requireAuth, (req, res) => {
  const proxies = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all();
  res.json(proxies);
});

app.post('/api/proxies', requireAuth, async (req, res) => {
  const { link, domain, email } = req.body;

  try {
    // 调用 cpm.sh 脚本生成配置（脚本内部不再 restart caddy，由后端管理）
    const cpmScript = '/etc/caddy/cpm.sh';
    await execAsync(
      `echo -e "${link}\n${domain}\n${email || ''}\n" | bash ${cpmScript} add`,
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

      // ✨ 按需启动 Caddy（首次添加时启动，已运行则 reload）
      await startCaddy();

      res.json({ success: true, message: '代理添加成功，Caddy 已启动' });
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

    // ✨ 删除后检查：还有代理就 reload，没有了就停止 Caddy 释放端口
    const remaining = await getSiteCount();
    if (remaining === 0) {
      await stopCaddy();
    } else {
      await startCaddy(); // 实际是 reload
    }

    res.json({ success: true, caddyRunning: remaining > 0 });
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
    const caddyRunning = await isCaddyRunning();
    const proxyCount = db.prepare('SELECT COUNT(*) as count FROM proxies').get();

    res.json({
      caddy: caddyRunning ? 'active' : 'inactive',
      caddyMode: caddyRunning ? '运行中 (监听 80/443)' : '已停止 (端口已释放)',
      proxyCount: proxyCount.count,
      uptime: process.uptime()
    });
  } catch (error) {
    res.json({ caddy: 'inactive', proxyCount: 0, uptime: 0 });
  }
});

// 手动控制 Caddy（管理员功能）
app.post('/api/caddy/start', requireAuth, async (req, res) => {
  try {
    await startCaddy();
    res.json({ success: true, message: 'Caddy 已启动' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/caddy/stop', requireAuth, async (req, res) => {
  try {
    await stopCaddy();
    res.json({ success: true, message: 'Caddy 已停止' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 前端路由 (SPA fallback) ==========
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Caddy Proxy Manager 后端运行在 http://localhost:${PORT}`);
});
