# 个人博客网站

基于 **Flask + Flask-SQLAlchemy + JWT + 原生 JavaScript** 的个人博客，**可直接公网部署**：同一进程同时提供 REST API 与前端页面（SPA），支持用户注册/登录、文章/分类/标签管理、Markdown 富文本与代码高亮，数据可持久化到 SQLite 或 PostgreSQL。

完整的部署方案（Docker / Render / Railway / 自有 VPS + 域名 + HTTPS）见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。

## 功能

- **前台**
  - 首页展示最新文章列表（标题、摘要、发布时间、标签、分类）
  - 文章详情页：Markdown 富文本渲染 + 代码高亮
  - 按标签 / 分类筛选文章，支持关键词搜索
  - 关于页（作者介绍）
  - 简洁现代设计，响应式布局，适配桌面与移动端
- **账号与鉴权**
  - 用户**注册 / 登录**（JWT 无状态鉴权，token 存于前端 localStorage）
  - 角色区分：普通用户 vs 管理员（RBAC，管理员接口返回 403 拦截）
- **后台**（`/admin`）
  - 管理员登录（JWT）
  - 文章：创建 / 编辑 / 删除，Markdown 编辑器带实时预览
  - 分类管理：增删改
  - 标签管理：增删改
  - 关于页内容编辑

## 快速开始（本地）

```bash
cd blog
pip install -r requirements.txt
cp .env.example .env          # 按需修改密钥
python app.py                 # 默认 http://localhost:5000
# 或使用跨平台生产级服务器：waitress-serve --port=5000 wsgi:app
```

- 前台：http://localhost:5000/
- 后台：http://localhost:5000/admin
- 默认管理员账号：`admin` / `admin123`（请务必修改 `.env` 中的 `ADMIN_PASSWORD`）

## 目录结构

```
blog/
├── app.py              # Flask 后端 + REST API + JWT 鉴权 + 数据库模型
├── wsgi.py             # 生产入口（供 gunicorn / waitress 加载 wsgi:app）
├── blog.db             # SQLite 数据库（首次运行自动生成并写入示例数据）
├── requirements.txt    # 依赖（Flask / SQLAlchemy / PyJWT / gunicorn / waitress ...）
├── .env.example        # 环境变量示例
├── Procfile            # 云部署（gunicorn）启动命令
├── Dockerfile          # 容器镜像
├── docker-compose.yml  # 一键起 Web + Postgres
├── nginx.conf          # VPS 反向代理示例（含 HTTPS 模板）
├── scripts/start.sh    # 容器/服务器启动脚本
├── DEPLOYMENT.md       # 完整部署文档
├── templates/
│   ├── index.html      # 前台单页
│   └── admin.html      # 后台单页
└── static/
    ├── css/{style.css, admin.css}
    ├── js/{public.js, admin.js}
    └── lib/            # 本地化的 marked / highlight.js / dompurify
```

## 备注

- 所有前端依赖（marked、highlight.js、DOMPurify）已本地化到 `static/lib`，无需联网 CDN。
- 数据库文件 `blog.db` 首次运行自动初始化并写入示例文章与管理员账号。
- 重置数据：删除 `blog.db` 后重新运行即可。
- 安全：生产务必修改 `SECRET_KEY` / `JWT_SECRET` / 管理员密码，并将 `CORS_ORIGINS` 限制为你的域名。

## 部署到 Git 平台（一键上线）

把整个 `blog/` 目录推到 GitHub / GitLab，再在 Render 或 Railway 连仓库即可自动部署，获得公网地址：

```bash
git init
git add .
git commit -m "blog: initial commit"
git remote add origin <你的仓库地址>
git push -u origin main
```

然后在 Render / Railway 新建 **Web Service** 连接该仓库：

| 配置项 | 值 |
|---|---|
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn -w 4 -b 0.0.0.0:$PORT wsgi:app` |
| 环境变量 | 见 `.env.example`：`DATABASE_URL` / `SECRET_KEY` / `JWT_SECRET` / `ADMIN_PASSWORD` / `CORS_ORIGINS` 等 |

部署完成后自动获得如 `https://your-blog.onrender.com` 的公网地址，直接可访问。

> 本仓库已配置 `.gitignore`，`.env`、`blog.db`、虚拟环境等敏感 / 本地文件**不会被提交**。首次部署请确保通过环境变量传入真实密钥，不要依赖默认值。
