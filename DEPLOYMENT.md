# 部署文档（生产上线）

本项目是一个**可直接公网部署**的个人博客：同一进程同时提供 REST API 与前端页面（SPA）。
支持用户注册/登录（JWT 鉴权）、文章/分类/标签管理、Markdown 富文本与代码高亮，数据可持久化到 SQLite 或 PostgreSQL。

---

## 一、本地运行（开发/演示）

```bash
cd blog
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # 按需修改密钥
python app.py                                        # 默认 http://localhost:5000
```

- 前台：http://localhost:5000/
- 后台：http://localhost:5000/admin （默认管理员 `admin / admin123`，请务必修改）

> **WSGI 服务器选择**
> - **gunicorn**：生产标准，但**仅支持 Linux / macOS**（其依赖 POSIX 模块 `fcntl`，无法在 Windows 运行）。所有云部署（Docker / Render / Railway / VPS）均使用它。
> - **waitress**：纯 Python、**跨平台（含 Windows）** 的生产级 WSGI 服务器，适合本机演示或 Windows 部署。
>   本地想用更接近生产的方式运行，可执行：
>   ```bash
>   waitress-serve --port=5000 wsgi:app
>   ```
>   （`wsgi:app` 即生产入口，启动时会自动建表并写入种子数据。）

---

## 二、环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SECRET_KEY` | Flask 会话/签名密钥，**生产必须修改** | dev-secret |
| `JWT_SECRET` | JWT 签名密钥，**生产必须修改** | 同 SECRET_KEY |
| `DATABASE_URL` | 数据库连接串 | `sqlite:///blog.db` |
| `ADMIN_USERNAME` | 初始管理员用户名（仅首次为空时创建） | admin |
| `ADMIN_PASSWORD` | 初始管理员密码 | admin123 |
| `ADMIN_EMAIL` | 初始管理员邮箱 | admin@example.com |
| `PORT` | 监听端口 | 5000 |
| `CORS_ORIGINS` | 允许跨域来源，`*` 或逗号分隔域名 | `*` |
| `JWT_EXP_DAYS` | JWT 有效期（天） | 7 |

> ⚠️ 切勿把真实 `.env` 提交到代码仓库；`.env` 已在 `.gitignore` 建议中忽略。

---

## 三、数据库选择

- **SQLite**：零配置，适合个人博客/低流量。文件即 `blog.db`。
  - 多 worker 并发写入可能遇到锁，建议单 worker 或改用 PostgreSQL。
- **PostgreSQL（推荐生产）**：修改 `DATABASE_URL` 为：
  ```
  postgresql://<user>:<password>@<host>:5432/<dbname>
  ```
  `psycopg2-binary` 已包含在依赖中，无需额外操作。

---

## 四、方式 A：Docker Compose（最省心、含 Postgres）

```bash
cd blog
cp .env.example .env
# 编辑 .env，至少修改 SECRET_KEY / JWT_SECRET / ADMIN_PASSWORD
docker compose up -d --build
```

- 访问 http://<服务器IP>:5000
- 数据持久化在 `pgdata` 卷中；如需升级，重新 `docker compose up -d --build` 即可。

---

## 五、方式 B：Render（免费额度、自动 HTTPS）

1. 在 Render 新建 **Blueprint** 或 **Web Service**，关联本仓库。
2. 构建命令：`pip install -r requirements.txt`
3. 启动命令：`gunicorn -w 4 --preload -b 0.0.0.0:$PORT wsgi:app`
4. 在 Render 控制台的 **Environment** 中添加上述环境变量（`DATABASE_URL` 可用 Render 自带的 Postgres 实例，或选 SQLite 入门）。
5. 绑定自定义域名 → Render 自动签发 SSL 证书。

> 仓库已包含 `Procfile`，Render 会自动识别。

---

## 六、方式 C：Railway

1. 新建 Project → Deploy from GitHub repo。
2. 添加 PostgreSQL 插件，复制其 `DATABASE_URL`。
3. 设置环境变量（同上文），将 `DATABASE_URL` 指向 Railway 的 Postgres。
4. 启动命令：`gunicorn -w 4 --preload -b 0.0.0.0:$PORT wsgi:app`
5. 绑定域名并开启 HTTPS（Railway 默认提供）。

---

## 七、方式 D：自有 VPS（nginx + gunicorn + systemd + HTTPS）

1. 安装 Python 3.12、PostgreSQL、Nginx：
   ```bash
   # Debian/Ubuntu 示例
   sudo apt update && sudo apt install -y python3-venv nginx postgresql
   ```
2. 拉取代码并安装依赖：
   ```bash
   git clone <repo> /var/www/blog && cd /var/www/blog
   python3 -m venv venv && source venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env   # 修改密钥与 DATABASE_URL
   ```
3. 创建 systemd 服务（`/etc/systemd/system/blog.service`）：
   ```ini
   [Unit]
   Description=Blog Gunicorn
   After=network.target

   [Service]
   User=www-data
   WorkingDirectory=/var/www/blog
   EnvironmentFile=/var/www/blog/.env
   ExecStart=/var/www/blog/venv/bin/gunicorn -w 4 --preload -b 127.0.0.1:5000 wsgi:app
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now blog
   ```
4. 配置 Nginx：将仓库内的 `nginx.conf` 复制到 `/etc/nginx/conf.d/your-domain.conf`，
   修改 `server_name` 与 `root`/`alias` 路径，然后：
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
5. HTTPS（Let's Encrypt）：
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com -d www.your-domain.com
   ```
   证书会自动续期，Nginx 配置中的 443 段可启用。

---

## 八、域名与公网访问要点

- 在域名服务商处添加 **A 记录**指向服务器公网 IP（或平台提供的 CNAME）。
- 等待 DNS 生效后（通常几分钟～几小时），在部署平台/服务器绑定域名并开启 HTTPS。
- 防火墙放行 80/443（平台托管通常已处理；VPS 需 `ufw allow 'Nginx Full'`）。
- 首页路径 `/`、后台 `/admin`、API 前缀 `/api`。

---

## 九、API 速览

公开（无需登录）：
- `GET /api/posts?page=&per_page=&tag=&category=&q=` 文章列表
- `GET /api/posts/<id>` 文章详情
- `GET /api/categories` / `GET /api/tags` 分类/标签（含计数）
- `GET /api/about` 关于页内容
- `GET /api/health` 健康检查（部署平台可用作探活）

鉴权（注册/登录返回 `token`，后续请求头带 `Authorization: Bearer <token>`）：
- `POST /api/auth/register` `{username,password,email?,display_name?}`
- `POST /api/auth/login` `{username,password}`
- `GET  /api/auth/me` 当前用户
- 管理（需管理员 token）：`/api/admin/posts` (GET/POST/PUT/DELETE)、`/api/admin/categories`、`/api/admin/tags`、`/api/admin/about`

---

## 十、安全与运维建议

- **必须**修改 `SECRET_KEY` / `JWT_SECRET` / 管理员密码。
- 生产环境将 `CORS_ORIGINS` 限制为你的前端域名，而非 `*`。
- 生产使用 PostgreSQL + 多 worker；SQLite 仅适合单机低并发。
- 定期备份数据库（`blog.db` 文件或 Postgres 逻辑备份）。
- 日志：gunicorn 默认输出到 stdout，平台可查看；VPS 用 `journalctl -u blog`。
