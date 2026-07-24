/* ===================== 公共前端逻辑（含 JWT 鉴权） ===================== */
(function () {
  "use strict";

  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const toastEl = document.getElementById("toast");
  const authArea = document.getElementById("authArea");
  const TOKEN_KEY = "blog_token";

  if (window.marked) marked.setOptions({ gfm: true, breaks: true });

  let TOKEN = localStorage.getItem(TOKEN_KEY) || "";
  let CURRENT = null; // 当前登录用户

  /* ---------- 工具函数 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }
  function renderMarkdown(md) {
    let html = ""; try { html = marked.parse(md || ""); } catch (e) { html = esc(md || ""); }
    if (window.DOMPurify) html = DOMPurify.sanitize(html);
    return html;
  }
  function highlightWithin(root) {
    if (window.hljs) root.querySelectorAll("pre code").forEach((b) => { try { hljs.highlightElement(b); } catch (e) {} });
  }
  function setToken(t) { TOKEN = t || ""; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
  async function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (TOKEN) opts.headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(url, opts);
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("请求失败 " + res.status));
    return data;
  }
  async function authApi(url, body) {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("请求失败 " + res.status));
    return data;
  }

  /* ---------- 登录态 / 导航鉴权区 ---------- */
  async function refreshAuth() {
    if (!TOKEN) { CURRENT = null; renderAuthArea(); return; }
    try {
      const d = await api("/api/auth/me");
      CURRENT = d.user;
    } catch (e) { CURRENT = null; setToken(""); }
    renderAuthArea();
  }
  function renderAuthArea() {
    if (CURRENT) {
      authArea.innerHTML =
        `<span class="user-box">👋 <strong>${esc(CURRENT.display_name || CURRENT.username)}</strong></span>` +
        `<button class="btn btn-ghost btn-sm" id="logoutBtn">退出</button>`;
      document.getElementById("logoutBtn").onclick = () => {
        setToken(""); CURRENT = null; renderAuthArea(); toast("已退出登录");
      };
    } else {
      authArea.innerHTML =
        `<button class="btn btn-ghost btn-sm" id="loginOpen">登录</button>` +
        `<button class="btn btn-primary btn-sm" id="regOpen">注册</button>`;
      document.getElementById("loginOpen").onclick = () => openModal("login");
      document.getElementById("regOpen").onclick = () => openModal("reg");
    }
  }

  /* ---------- 登录/注册弹窗 ---------- */
  const modal = document.getElementById("authModal");
  function openModal(which) {
    modal.style.display = "flex";
    showTab(which || "login");
    document.getElementById("loginErr").textContent = "";
    document.getElementById("regErr").textContent = "";
  }
  function closeModal() { modal.style.display = "none"; }
  function showTab(which) {
    const isLogin = which === "login";
    document.getElementById("tabLogin").classList.toggle("active", isLogin);
    document.getElementById("tabReg").classList.toggle("active", !isLogin);
    document.getElementById("loginForm").style.display = isLogin ? "block" : "none";
    document.getElementById("regForm").style.display = isLogin ? "none" : "block";
  }
  document.getElementById("tabLogin").onclick = () => showTab("login");
  document.getElementById("tabReg").onclick = () => showTab("reg");
  document.getElementById("authClose").onclick = closeModal;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("loginErr"); err.textContent = "";
    try {
      const d = await authApi("/api/auth/login", {
        username: document.getElementById("loginIdent").value.trim(),
        password: document.getElementById("loginPwd").value,
      });
      setToken(d.token); CURRENT = d.user; renderAuthArea(); closeModal(); toast("登录成功");
    } catch (ex) { err.textContent = ex.message; }
  });
  document.getElementById("regForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("regErr"); err.textContent = "";
    try {
      const d = await authApi("/api/auth/register", {
        username: document.getElementById("regUser").value.trim(),
        email: document.getElementById("regEmail").value.trim(),
        password: document.getElementById("regPwd").value,
      });
      setToken(d.token); CURRENT = d.user; renderAuthArea(); closeModal(); toast("注册成功，已自动登录");
    } catch (ex) { err.textContent = ex.message; }
  });

  /* ---------- 侧边栏（缓存一次） ---------- */
  let _sideCache = null;
  async function ensureSidebar() {
    if (_sideCache) { renderSidebar(_sideCache); return; }
    try {
      const [cats, tags] = await Promise.all([api("/api/categories"), api("/api/tags")]);
      _sideCache = { cats, tags }; renderSidebar(_sideCache);
    } catch (e) {}
  }
  function renderSidebar({ cats, tags }) {
    const catHtml = (cats && cats.length)
      ? cats.map((c) => `<a href="#/category/${esc(c.slug)}">${esc(c.name)} <span class="count">${c.count}</span></a>`).join("")
      : '<span style="color:var(--text-mute);font-size:.85rem">暂无分类</span>';
    const tagHtml = (tags && tags.length)
      ? tags.map((t) => `<a href="#/tag/${esc(t.slug)}">${esc(t.name)} <span class="count">${t.count}</span></a>`).join("")
      : '<span style="color:var(--text-mute);font-size:.85rem">暂无标签</span>';
    sidebar.innerHTML = `
      <div class="widget">
        <h3>搜索</h3>
        <div class="search-box">
          <input id="searchInput" type="text" placeholder="搜索文章…" />
          <button class="chip" id="searchBtn" style="border:none;cursor:pointer">搜索</button>
        </div>
      </div>
      <div class="widget"><h3>分类</h3><div class="cat-list">${catHtml}</div></div>
      <div class="widget"><h3>标签</h3><div class="tag-cloud">${tagHtml}</div></div>`;
    const si = document.getElementById("searchInput");
    const go = () => { const q = si.value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/"; };
    document.getElementById("searchBtn").onclick = go;
    si.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  /* ---------- 文章卡片 ---------- */
  function postCard(p) {
    const cat = p.category ? `<a class="chip cat" href="#/category/${esc(p.category.slug)}">${esc(p.category.name)}</a>` : "";
    const tags = (p.tags || []).map((t) => `<a class="chip" href="#/tag/${esc(t.slug)}">#${esc(t.name)}</a>`).join("");
    return `
      <article class="post-card" onclick="location.hash='#/post/${p.id}'">
        <h2><a href="#/post/${p.id}">${esc(p.title)}</a></h2>
        <div class="post-meta">
          <span>📅 ${fmtDate(p.published_at || p.created_at)}</span>
          ${p.category ? `<span class="dot"></span>${cat}` : ""}
        </div>
        <p class="post-summary">${esc(p.summary || "")}</p>
        <div class="chip-row">${tags}</div>
      </article>`;
  }

  /* ---------- 列表视图 ---------- */
  let _page = 1;
  async function renderList(title, params) {
    app.innerHTML = `<div class="loading">加载中…</div>`;
    try {
      const qs = new URLSearchParams(params); qs.set("page", String(_page));
      const data = await api("/api/posts?" + qs.toString());
      let html = `<h1 class="page-title">${esc(title)}</h1>`;
      if (!data.posts.length) {
        html += `<div class="empty">这里还没有文章 📝</div>`;
      } else {
        html += data.posts.map(postCard).join("");
        if (data.total_pages > 1) {
          html += `<div class="pager">
            <button ${_page <= 1 ? "disabled" : ""} id="prevPage">上一页</button>
            <span style="align-self:center;color:var(--text-mute);font-size:.85rem">${_page} / ${data.total_pages}</span>
            <button ${_page >= data.total_pages ? "disabled" : ""} id="nextPage">下一页</button></div>`;
        }
      }
      app.innerHTML = html;
      const prev = document.getElementById("prevPage"), next = document.getElementById("nextPage");
      if (prev) prev.onclick = () => { _page--; renderList(title, params); window.scrollTo(0, 0); };
      if (next) next.onclick = () => { _page++; renderList(title, params); window.scrollTo(0, 0); };
    } catch (e) { app.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
  }

  /* ---------- 文章详情 ---------- */
  async function renderPost(id) {
    app.innerHTML = `<div class="loading">加载中…</div>`;
    try {
      const p = await api("/api/posts/" + id);
      const cat = p.category ? `<a class="chip cat" href="#/category/${esc(p.category.slug)}">${esc(p.category.name)}</a>` : "";
      const tags = (p.tags || []).map((t) => `<a class="chip" href="#/tag/${esc(t.slug)}">#${esc(t.name)}</a>`).join("");
      const el = document.createElement("div");
      el.innerHTML = `
        <a class="back-link" href="#/">← 返回首页</a>
        <article class="article">
          <h1>${esc(p.title)}</h1>
          <div class="post-meta"><span>📅 发布于 ${fmtDate(p.published_at || p.created_at)}</span>
            ${p.category ? `<span class="dot"></span>${cat}` : ""}</div>
          <div class="article-content">${renderMarkdown(p.content)}</div>
          <div class="chip-row" style="margin-top:24px">${tags}</div>
        </article>`;
      app.innerHTML = ""; app.appendChild(el); highlightWithin(el); window.scrollTo(0, 0);
    } catch (e) { app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  /* ---------- 关于页 ---------- */
  async function renderAbout() {
    app.innerHTML = `<div class="loading">加载中…</div>`;
    try {
      const data = await api("/api/about");
      const el = document.createElement("div");
      el.innerHTML = `<div class="about-card article-content">${renderMarkdown(data.content)}</div>`;
      app.innerHTML = ""; app.appendChild(el); highlightWithin(el); window.scrollTo(0, 0);
    } catch (e) { app.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
  }

  /* ---------- 路由 ---------- */
  function router() {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\//, "").split("/");
    const root = parts[0] || "";
    document.querySelectorAll(".nav-links a").forEach((a) => a.classList.remove("active"));
    const hl = document.querySelector(`.nav-links a[data-route="${root === "" ? "home" : root}"]`);
    if (hl) hl.classList.add("active");

    if (root === "" || root === "search") {
      _page = 1;
      if (root === "search") renderList(`搜索：“${decodeURIComponent(parts[1] || "")}”`, { q: parts[1] });
      else renderList("最新文章", {});
    } else if (root === "post") { renderPost(parts[1]); }
    else if (root === "tag") { _page = 1; renderList(`标签：#${decodeURIComponent(parts[1] || "")}`, { tag: parts[1] }); }
    else if (root === "category") { _page = 1; renderList(`分类：${decodeURIComponent(parts[1] || "")}`, { category: parts[1] }); }
    else if (root === "about") { renderAbout(); }
    else { app.innerHTML = `<div class="empty">页面不存在</div>`; }
    ensureSidebar();
  }

  /* ---------- 移动端菜单 ---------- */
  document.getElementById("navToggle").addEventListener("click", () => document.getElementById("navLinks").classList.toggle("open"));
  document.getElementById("navLinks").addEventListener("click", (e) => { if (e.target.tagName === "A") document.getElementById("navLinks").classList.remove("open"); });

  document.getElementById("year").textContent = new Date().getFullYear();
  window.addEventListener("hashchange", router);
  refreshAuth();
  router();
})();
