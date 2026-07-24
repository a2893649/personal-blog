/* ===================== 后台管理逻辑（JWT 鉴权） ===================== */
(function () {
  "use strict";

  const root = document.getElementById("root");
  const toastEl = document.getElementById("toast");
  const TOKEN_KEY = "blog_token";
  if (window.marked) marked.setOptions({ gfm: true, breaks: true });

  let TOKEN = localStorage.getItem(TOKEN_KEY) || "";
  let me = { logged_in: false, display_name: "" };
  let section = "posts";

  function setToken(t) { TOKEN = t || ""; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }
  async function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (TOKEN) opts.headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(url, opts);
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("请求失败 " + res.status));
    return data;
  }
  function renderMarkdown(md) {
    let html = ""; try { html = marked.parse(md || ""); } catch (e) { html = esc(md || ""); }
    if (window.DOMPurify) html = DOMPurify.sanitize(html);
    return html;
  }
  function highlightWithin(el) {
    if (window.hljs) el.querySelectorAll("pre code").forEach((b) => { try { hljs.highlightElement(b); } catch (e) {} });
  }

  /* ---------- 登录 ---------- */
  function renderLogin() {
    root.innerHTML = `
      <div class="login-box">
        <h2>博客后台</h2>
        <p>请使用管理员账号登录</p>
        <div class="field">
          <label>用户名或邮箱</label>
          <input id="username" autocomplete="username" placeholder="admin" />
        </div>
        <div class="field">
          <label>密码</label>
          <input id="password" type="password" autocomplete="current-password" placeholder="••••••" />
        </div>
        <button class="btn btn-primary" id="loginBtn">登 录</button>
        <div class="hint">默认账号 admin / admin123，请登录后及时修改</div>
      </div>`;
    const submit = async () => {
      const ident = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      try {
        const d = await fetch("/api/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: ident, password }),
        });
        const data = await d.json();
        if (!d.ok) throw new Error(data.error || "登录失败");
        setToken(data.token);
        toast("登录成功"); boot();
      } catch (e) { toast(e.message); }
    };
    document.getElementById("loginBtn").onclick = submit;
    document.getElementById("password").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  /* ---------- 应用骨架 ---------- */
  async function boot() {
    try {
      const d = await api("/api/auth/me");
      if (d.user && d.user.is_admin) { me = { logged_in: true, display_name: d.user.display_name }; renderApp(); return; }
      if (d.user && !d.user.is_admin) { toast("当前账号不是管理员"); }
    } catch (e) {}
    setToken(""); me = { logged_in: false }; renderLogin();
  }

  function renderApp() {
    root.innerHTML = `
      <div class="admin-wrap">
        <div class="admin-topbar">
          <div class="atitle"><span class="logo">🍯</span> 博客后台管理</div>
          <div class="actions">
            <a class="btn btn-ghost btn-sm" href="/" target="_blank">查看前台</a>
            <span style="color:var(--text-mute);font-size:.85rem">${esc(me.display_name || "")}</span>
            <button class="btn btn-ghost btn-sm" id="logoutBtn">退出</button>
          </div>
        </div>
        <div class="tabs">
          <div class="tab ${section === "posts" ? "active" : ""}" data-s="posts">文章管理</div>
          <div class="tab ${section === "categories" ? "active" : ""}" data-s="categories">分类管理</div>
          <div class="tab ${section === "tags" ? "active" : ""}" data-s="tags">标签管理</div>
          <div class="tab ${section === "about" ? "active" : ""}" data-s="about">关于页</div>
        </div>
        <div id="panel"></div>
      </div>`;
    document.getElementById("logoutBtn").onclick = () => { setToken(""); me = { logged_in: false }; renderLogin(); };
    document.querySelectorAll(".tab").forEach((t) => t.onclick = () => { section = t.dataset.s; renderApp(); });
    if (section === "posts") renderPosts();
    else if (section === "categories") renderCategories();
    else if (section === "tags") renderTags();
    else if (section === "about") renderAbout();
  }

  /* ---------- 文章管理 ---------- */
  async function renderPosts() {
    const panel = document.getElementById("panel");
    panel.innerHTML = `<div class="panel"><div class="loading">加载中…</div></div>`;
    let posts = [];
    try { posts = await api("/api/admin/posts"); } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const rows = posts.length ? posts.map((p) => `
      <tr>
        <td><strong>${esc(p.title)}</strong></td>
        <td>${p.category ? esc(p.category.name) : "—"}</td>
        <td>${(p.tags || []).map((t) => esc(t)).join("、") || "—"}</td>
        <td>${p.status === "draft" ? '<span class="chip mute">草稿</span>' : '<span class="chip cat">已发布</span>'}</td>
        <td>${esc((p.updated_at || "").slice(0, 10))}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${p.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-del="${p.id}">删除</button>
        </div></td>
      </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--text-mute);padding:30px">暂无文章</td></tr>`;
    panel.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>文章列表（${posts.length}）</h2>
          <button class="btn btn-primary" id="newPost">+ 新建文章</button></div>
        <table class="tbl"><thead><tr><th>标题</th><th>分类</th><th>标签</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody></table>
      </div>`;
    document.getElementById("newPost").onclick = () => renderEditor(null);
    panel.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => renderEditor(Number(b.dataset.edit)));
    panel.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("确定删除这篇文章吗？此操作不可恢复。")) return;
      try { await api("/api/admin/posts/" + b.dataset.del, { method: "DELETE" }); toast("已删除"); renderPosts(); }
      catch (e) { toast(e.message); }
    });
  }

  async function renderEditor(id) {
    const panel = document.getElementById("panel");
    let post = { title: "", summary: "", content: "", category: "", tags: [], status: "published" };
    if (id) {
      try {
        const p = await api("/api/admin/posts/" + id);
        post = {
          title: p.title, summary: p.summary || "", content: p.content || "",
          category: p.category ? p.category.name : "", tags: (p.tags || []).map((t) => t.name),
          status: p.status || "published",
        };
      } catch (e) { toast(e.message); return; }
    }
    panel.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>${id ? "编辑文章" : "新建文章"}</h2>
          <button class="btn btn-ghost" id="back">返回列表</button></div>
        <div class="form-grid">
          <div class="field full"><label>标题 *</label><input id="f-title" value="${esc(post.title)}" placeholder="文章标题" /></div>
          <div class="field"><label>分类</label><input id="f-cat" value="${esc(post.category)}" placeholder="如：技术 / 随笔" /></div>
          <div class="field"><label>状态</label>
            <select id="f-status">
              <option value="published" ${post.status === "published" ? "selected" : ""}>已发布</option>
              <option value="draft" ${post.status === "draft" ? "selected" : ""}>草稿</option>
            </select></div>
          <div class="field full"><label>摘要（留空将自动截取正文）</label>
            <textarea id="f-summary" style="min-height:70px">${esc(post.summary)}</textarea></div>
          <div class="field full"><label>标签（用逗号分隔）</label>
            <input id="f-tags" value="${esc((post.tags || []).join(", "))}" placeholder="Python, Flask, 前端" /></div>
        </div>
        <div style="margin-top:16px">
          <label style="font-size:.85rem;font-weight:600;color:var(--text-soft)">正文（支持 Markdown）</label>
          <div class="editor" style="margin-top:6px">
            <textarea id="f-content" placeholder="在此输入 Markdown 内容…">${esc(post.content)}</textarea>
            <div class="preview article-content" id="preview"></div>
          </div>
        </div>
        <div style="margin-top:18px;display:flex;gap:10px">
          <button class="btn btn-primary" id="save">${id ? "保存修改" : "发布文章"}</button>
          <button class="btn btn-ghost" id="back2">取消</button>
        </div>
      </div>`;
    const contentEl = document.getElementById("f-content");
    const previewEl = document.getElementById("preview");
    const updatePreview = () => { previewEl.innerHTML = renderMarkdown(contentEl.value); highlightWithin(previewEl); };
    contentEl.addEventListener("input", updatePreview); updatePreview();
    const back = () => renderPosts();
    document.getElementById("back").onclick = back;
    document.getElementById("back2").onclick = back;
    document.getElementById("save").onclick = async () => {
      const payload = {
        title: document.getElementById("f-title").value.trim(),
        summary: document.getElementById("f-summary").value.trim(),
        category: document.getElementById("f-cat").value.trim(),
        status: document.getElementById("f-status").value,
        tags: document.getElementById("f-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
        content: contentEl.value,
      };
      if (!payload.title) { toast("标题不能为空"); return; }
      try {
        if (id) { await api("/api/admin/posts/" + id, { method: "PUT", body: JSON.stringify(payload) }); toast("已保存"); }
        else { await api("/api/admin/posts", { method: "POST", body: JSON.stringify(payload) }); toast("已发布"); }
        renderPosts();
      } catch (e) { toast(e.message); }
    };
  }

  /* ---------- 分类管理 ---------- */
  async function renderCategories() {
    const panel = document.getElementById("panel");
    panel.innerHTML = `<div class="panel"><div class="loading">加载中…</div></div>`;
    let cats = [];
    try { cats = await api("/api/admin/categories"); } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const rows = cats.length ? cats.map((c) => `
      <tr><td><strong>${esc(c.name)}</strong></td><td>${c.count}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${c.id}">重命名</button>
          <button class="btn btn-danger btn-sm" data-del="${c.id}">删除</button></div></td></tr>`).join("")
      : `<tr><td colspan="3" style="text-align:center;color:var(--text-mute);padding:30px">暂无分类</td></tr>`;
    panel.innerHTML = `
      <div class="panel"><div class="panel-head"><h2>分类管理（${cats.length}）</h2></div>
        <div class="field" style="max-width:320px;margin-bottom:18px"><label>新增分类</label>
          <div style="display:flex;gap:8px"><input id="newCat" placeholder="分类名称" />
            <button class="btn btn-primary btn-sm" id="addCat">添加</button></div></div>
        <table class="tbl"><thead><tr><th>名称</th><th>文章数</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    const refresh = () => renderCategories();
    document.getElementById("addCat").onclick = async () => {
      const name = document.getElementById("newCat").value.trim(); if (!name) return;
      try { await api("/api/admin/categories", { method: "POST", body: JSON.stringify({ name }) }); toast("已添加"); refresh(); }
      catch (e) { toast(e.message); }
    };
    panel.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async () => {
      const name = prompt("输入新的分类名称："); if (!name || !name.trim()) return;
      try { await api("/api/admin/categories/" + b.dataset.edit, { method: "PUT", body: JSON.stringify({ name: name.trim() }) }); toast("已更新"); refresh(); }
      catch (e) { toast(e.message); }
    });
    panel.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("确定删除该分类吗？文章将变为未分类。")) return;
      try { await api("/api/admin/categories/" + b.dataset.edit, { method: "DELETE" }); toast("已删除"); refresh(); }
      catch (e) { toast(e.message); }
    });
  }

  /* ---------- 标签管理 ---------- */
  async function renderTags() {
    const panel = document.getElementById("panel");
    panel.innerHTML = `<div class="panel"><div class="loading">加载中…</div></div>`;
    let tags = [];
    try { tags = await api("/api/admin/tags"); } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const rows = tags.length ? tags.map((t) => `
      <tr><td><strong>#${esc(t.name)}</strong></td><td>${t.count}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${t.id}">重命名</button>
          <button class="btn btn-danger btn-sm" data-del="${t.id}">删除</button></div></td></tr>`).join("")
      : `<tr><td colspan="3" style="text-align:center;color:var(--text-mute);padding:30px">暂无标签</td></tr>`;
    panel.innerHTML = `
      <div class="panel"><div class="panel-head"><h2>标签管理（${tags.length}）</h2></div>
        <div class="field" style="max-width:320px;margin-bottom:18px"><label>新增标签</label>
          <div style="display:flex;gap:8px"><input id="newTag" placeholder="标签名称" />
            <button class="btn btn-primary btn-sm" id="addTag">添加</button></div></div>
        <table class="tbl"><thead><tr><th>名称</th><th>使用次数</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    const refresh = () => renderTags();
    document.getElementById("addTag").onclick = async () => {
      const name = document.getElementById("newTag").value.trim(); if (!name) return;
      try { await api("/api/admin/tags", { method: "POST", body: JSON.stringify({ name }) }); toast("已添加"); refresh(); }
      catch (e) { toast(e.message); }
    };
    panel.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async () => {
      const name = prompt("输入新的标签名称："); if (!name || !name.trim()) return;
      try { await api("/api/admin/tags/" + b.dataset.edit, { method: "PUT", body: JSON.stringify({ name: name.trim() }) }); toast("已更新"); refresh(); }
      catch (e) { toast(e.message); }
    });
    panel.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("确定删除该标签吗？")) return;
      try { await api("/api/admin/tags/" + b.dataset.edit, { method: "DELETE" }); toast("已删除"); refresh(); }
      catch (e) { toast(e.message); }
    });
  }

  /* ---------- 关于页编辑 ---------- */
  async function renderAbout() {
    const panel = document.getElementById("panel");
    panel.innerHTML = `<div class="panel"><div class="loading">加载中…</div></div>`;
    let content = "";
    try { content = (await api("/api/admin/about")).content; } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    panel.innerHTML = `
      <div class="panel"><div class="panel-head"><h2>关于页内容（Markdown）</h2></div>
        <div class="editor"><textarea id="aboutContent" style="min-height:360px">${esc(content)}</textarea>
          <div class="preview article-content" id="aboutPreview"></div></div>
        <div style="margin-top:16px"><button class="btn btn-primary" id="saveAbout">保存</button></div>
      </div>`;
    const ta = document.getElementById("aboutContent");
    const pv = document.getElementById("aboutPreview");
    const upd = () => { pv.innerHTML = renderMarkdown(ta.value); highlightWithin(pv); };
    ta.addEventListener("input", upd); upd();
    document.getElementById("saveAbout").onclick = async () => {
      try { await api("/api/admin/about", { method: "PUT", body: JSON.stringify({ content: ta.value }) }); toast("已保存"); }
      catch (e) { toast(e.message); }
    };
  }

  boot();
})();
