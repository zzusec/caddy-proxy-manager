const API_BASE = 'http://localhost:3000/api';

class App {
  constructor() {
    this.currentUser = null;
    this.currentView = 'dashboard';
    this.proxies = [];
    this.init();
  }

  async init() {
    await this.checkAuth();
    this.render();
  }

  async checkAuth() {
    try {
      const res = await fetch(`${API_BASE}/me`, { credentials: 'include' });
      if (res.ok) {
        this.currentUser = await res.json();
      }
    } catch (e) {
      this.currentUser = null;
    }
  }

  async login(username, password) {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error('登录失败');
    this.currentUser = await res.json();
    this.render();
  }

  async logout() {
    await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
    this.currentUser = null;
    this.render();
  }

  async loadProxies() {
    const res = await fetch(`${API_BASE}/proxies`, { credentials: 'include' });
    this.proxies = await res.json();
    this.renderProxyList();
  }

  async addProxy(link, domain, email) {
    const res = await fetch(`${API_BASE}/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ link, domain, email })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '添加失败');
    }
    await this.loadProxies();
  }

  async deleteProxy(domain) {
    if (!confirm(`确定删除代理 ${domain}?`)) return;
    const res = await fetch(`${API_BASE}/proxies/${domain}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('删除失败');
    await this.loadProxies();
  }

  render() {
    const app = document.getElementById('app');
    if (!this.currentUser) {
      app.innerHTML = this.renderLogin();
      this.bindLoginEvents();
    } else {
      app.innerHTML = this.renderDashboard();
      this.bindDashboardEvents();
      this.loadProxies();
    }
  }

  renderLogin() {
    return `
      <div class="login-container">
        <div class="login-box">
          <div class="login-title">
            <div class="logo-icon" style="margin: 0 auto 20px; width: 60px; height: 60px; font-size: 24px;">C</div>
            Caddy Proxy Manager
          </div>
          <form id="loginForm">
            <div class="form-group">
              <label class="form-label">用户名</label>
              <input type="text" class="form-input" name="username" required autofocus>
            </div>
            <div class="form-group">
              <label class="form-label">密码</label>
              <input type="password" class="form-input" name="password" required>
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%;">登录</button>
          </form>
          <div id="loginError" style="color: #f56565; margin-top: 15px; text-align: center;"></div>
        </div>
      </div>
    `;
  }

  renderDashboard() {
    return `
      <div class="header">
        <div class="logo">
          <div class="logo-icon">C</div>
          <span>Caddy Proxy Manager</span>
        </div>
        <div class="user-info">
          <div class="user-avatar">👤</div>
          <span>${this.currentUser.username}</span>
          <button class="btn btn-danger" id="logoutBtn">退出</button>
        </div>
      </div>

      <div class="container">
        <div class="nav">
          <div class="nav-item active" data-view="dashboard">📊 仪表板</div>
          <div class="nav-item" data-view="proxies">🔀 代理服务列表</div>
          <div class="nav-item" data-view="logs">📝 日志</div>
        </div>

        <div id="content"></div>
      </div>

      <div class="modal" id="addProxyModal">
        <div class="modal-content">
          <div class="modal-header">添加代理服务</div>
          <form id="addProxyForm">
            <div class="form-group">
              <label class="form-label">代理链接 (vmess/vless/trojan/ss)</label>
              <textarea class="form-input" name="link" rows="3" required placeholder="vmess://..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">域名</label>
              <input type="text" class="form-input" name="domain" required placeholder="api.example.com">
            </div>
            <div class="form-group">
              <label class="form-label">邮箱 (用于 SSL 证书，可选)</label>
              <input type="email" class="form-input" name="email" placeholder="admin@example.com">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button type="button" class="btn" id="cancelAddProxy">取消</button>
              <button type="submit" class="btn btn-success">添加</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  renderProxyList() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">代理服务列表</div>
          <button class="btn btn-success" id="addProxyBtn">+ 添加代理服务</button>
        </div>
        ${this.proxies.length === 0 ? '<div class="loading">暂无代理服务</div>' : `
          <table>
            <thead>
              <tr>
                <th>来源</th>
                <th>目标</th>
                <th>协议</th>
                <th>传输</th>
                <th>SSL</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${this.proxies.map(p => `
                <tr>
                  <td><strong>${p.domain}</strong></td>
                  <td>${p.upstream}</td>
                  <td><span class="badge badge-success">${p.proto.toUpperCase()}</span></td>
                  <td>${p.net}</td>
                  <td><span class="badge badge-success">Let's Encrypt</span></td>
                  <td>
                    <span class="status-dot status-online"></span>
                    <span class="badge badge-success">在线</span>
                  </td>
                  <td>${new Date(p.created_at).toLocaleString('zh-CN')}</td>
                  <td class="actions">
                    <button class="action-btn" onclick="app.deleteProxy('${p.domain}')">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  bindLoginEvents() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const username = form.username.value;
      const password = form.password.value;
      try {
        await this.login(username, password);
      } catch (err) {
        document.getElementById('loginError').textContent = err.message;
      }
    });
  }

  bindDashboardEvents() {
    document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        e.target.classList.add('active');
        this.currentView = e.target.dataset.view;
        this.renderView();
      });
    });

    this.renderView();
  }

  renderView() {
    const content = document.getElementById('content');
    switch (this.currentView) {
      case 'dashboard':
        content.innerHTML = `
          <div class="card">
            <div class="card-title">系统概览</div>
            <div style="margin-top: 20px;">
              <p>代理服务数量: <strong>${this.proxies.length}</strong></p>
              <p>Caddy 状态: <span class="badge badge-success">运行中</span></p>
            </div>
          </div>
        `;
        break;
      case 'proxies':
        this.loadProxies();
        const addBtn = document.getElementById('addProxyBtn');
        if (addBtn) {
          addBtn.addEventListener('click', () => this.showAddProxyModal());
        }
        break;
      case 'logs':
        content.innerHTML = `
          <div class="card">
            <div class="card-title">系统日志</div>
            <div class="loading">日志功能开发中...</div>
          </div>
        `;
        break;
    }
  }

  showAddProxyModal() {
    const modal = document.getElementById('addProxyModal');
    modal.classList.add('active');

    document.getElementById('cancelAddProxy').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    document.getElementById('addProxyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      try {
        await this.addProxy(form.link.value, form.domain.value, form.email.value);
        modal.classList.remove('active');
        form.reset();
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

const app = new App();
window.app = app;
