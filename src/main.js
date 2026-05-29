const API_BASE = window.location.origin + '/api';

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

    // 绑定添加按钮事件（在渲染后）
    const addBtn = document.getElementById('addProxyBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.showAddProxyModal());
    }
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
          <button class="btn btn-primary" id="changePasswordBtn">修改密码</button>
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

      <div class="modal" id="changePasswordModal">
        <div class="modal-content">
          <div class="modal-header">修改密码</div>
          <form id="changePasswordForm">
            <div class="form-group">
              <label class="form-label">当前密码</label>
              <input type="password" class="form-input" name="oldPassword" required>
            </div>
            <div class="form-group">
              <label class="form-label">新密码 (至少 6 位)</label>
              <input type="password" class="form-input" name="newPassword" required minlength="6">
            </div>
            <div class="form-group">
              <label class="form-label">确认新密码</label>
              <input type="password" class="form-input" name="confirmPassword" required minlength="6">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button type="button" class="btn" id="cancelChangePassword">取消</button>
              <button type="submit" class="btn btn-success">确认修改</button>
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
    document.getElementById('changePasswordBtn').addEventListener('click', () => this.showChangePasswordModal());

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
        this.loadDashboard();
        break;
      case 'proxies':
        this.loadProxies();
        break;
      case 'logs':
        this.loadLogs();
        break;
    }
  }

  async loadDashboard() {
    const content = document.getElementById('content');
    try {
      const res = await fetch(`${API_BASE}/status`, { credentials: 'include' });
      const status = await res.json();
      const caddyOnline = status.caddy === 'active';

      content.innerHTML = `
        <div class="card">
          <div class="card-title">系统概览</div>
          <div style="margin-top: 20px; line-height: 2;">
            <p>📦 代理服务数量: <strong>${status.proxyCount}</strong></p>
            <p>🔄 Caddy 状态:
              <span class="badge badge-${caddyOnline ? 'success' : 'warning'}">
                ${status.caddyMode || (caddyOnline ? '运行中' : '已停止')}
              </span>
            </p>
            <p>⏱️  运行时长: <strong>${Math.floor(status.uptime / 60)} 分钟</strong></p>
          </div>
          <div style="margin-top: 20px; padding: 15px; background: #f7fafc; border-radius: 6px; font-size: 13px; color: #4a5568;">
            💡 <strong>按需启动模式</strong>:
            添加首个代理服务时，Caddy 自动启动并监听 80/443 端口；
            删除所有代理后，Caddy 自动停止释放端口。
          </div>
          ${status.proxyCount > 0 ? `
            <div style="margin-top: 20px;">
              <button class="btn ${caddyOnline ? 'btn-danger' : 'btn-success'}" id="toggleCaddyBtn">
                ${caddyOnline ? '🛑 手动停止 Caddy' : '🚀 手动启动 Caddy'}
              </button>
            </div>
          ` : ''}
        </div>
      `;

      const toggleBtn = document.getElementById('toggleCaddyBtn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', async () => {
          const action = caddyOnline ? 'stop' : 'start';
          try {
            const r = await fetch(`${API_BASE}/caddy/${action}`, {
              method: 'POST',
              credentials: 'include'
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            alert(data.message);
            this.loadDashboard();
          } catch (e) {
            alert(e.message);
          }
        });
      }
    } catch (e) {
      content.innerHTML = `<div class="card"><div class="loading" style="color: #f56565;">加载失败: ${e.message}</div></div>`;
    }
  }

  async loadLogs() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">系统日志</div>
          <button class="btn btn-primary" id="refreshLogsBtn">刷新</button>
        </div>
        <div class="loading">加载中...</div>
      </div>
    `;

    try {
      const res = await fetch(`${API_BASE}/logs`, { credentials: 'include' });
      const logs = await res.json();

      content.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">系统日志</div>
            <button class="btn btn-primary" id="refreshLogsBtn">刷新</button>
          </div>
          ${logs.length === 0 ? '<div class="loading">暂无日志</div>' : `
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>消息</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map(log => `
                  <tr>
                    <td>${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                    <td><span class="badge badge-${log.type === 'error' ? 'danger' : 'success'}">${log.type}</span></td>
                    <td>${log.message}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      `;

      const refreshBtn = document.getElementById('refreshLogsBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.loadLogs());
      }
    } catch (err) {
      content.innerHTML = `
        <div class="card">
          <div class="card-title">系统日志</div>
          <div class="loading" style="color: #f56565;">加载失败: ${err.message}</div>
        </div>
      `;
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

  showChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    modal.classList.add('active');

    const cancelBtn = document.getElementById('cancelChangePassword');
    const form = document.getElementById('changePasswordForm');

    // 移除旧事件监听器，避免重复绑定
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newCancelBtn.addEventListener('click', () => {
      modal.classList.remove('active');
      newForm.reset();
    });

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const oldPassword = f.oldPassword.value;
      const newPassword = f.newPassword.value;
      const confirmPassword = f.confirmPassword.value;

      if (newPassword !== confirmPassword) {
        alert('两次输入的新密码不一致');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ oldPassword, newPassword })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '修改失败');

        alert('密码修改成功！请重新登录');
        modal.classList.remove('active');
        f.reset();
        await this.logout();
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

const app = new App();
window.app = app;
