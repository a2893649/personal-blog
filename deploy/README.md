# 公网部署指南（VPS + 域名 + HTTPS）

本目录包含将个人博客部署到公网所需的**全部配置文件与脚本**。目标服务器建议 **Ubuntu 22.04 / 24.04**（Debian 系同理）。

> 覆盖范围对应需求：① 服务器/域名/HTTPS ② Nginx 反代 ③ 防火墙仅开 80/443(及 22) ④ 守护进程+自动重启+日志 ⑤ 环境变量与敏感信息管理 ⑥ 访问地址与验证步骤。

---

## 一、前置条件（你需要准备的）

| 项目 | 说明 |
|---|---|
| 一台 VPS/云服务器 | 公网 IP，Ubuntu 22.04+，建议 ≥1 vCPU / 1 GB RAM |
| 一个域名 | 如 `blog.example.com`，并已把 **A 记录指向服务器公网 IP** |
| 服务器 root SSH 访问 | 部署脚本需 root 权限 |

> 代码已发布在 https://github.com/a2893649/personal-blog ，脚本会自动 `git clone`。

---

## 二、一键部署

SSH 登录服务器后，以 root 执行：

```bash
# 拉取部署脚本
curl -fsSL https://raw.githubusercontent.com/a2893649/personal-blog/main/deploy/setup-server.sh -o /tmp/setup-server.sh
bash /tmp/setup-server.sh blog.example.com admin@example.com
```

脚本会依次完成（共 8 步，全程无需人工干预）：

1. 安装系统依赖（Python、Nginx、UFW、Certbot、PostgreSQL…）
2. 创建专用低权限运行用户 `blog`（无登录 shell）
3. 克隆代码到 `/opt/blog`
4. 创建 Python 虚拟环境并安装依赖
5. 自动创建 PostgreSQL 数据库与随机密码
6. 生成 `/opt/blog/.env`（密钥随机、权限 `600`）
7. 注册 **systemd 守护进程**（`Restart=always` 自动重启）
8. 配置 **Nginx 反代** + **UFW 防火墙** + **Let's Encrypt HTTPS**

完成后访问：

- 前台：**https://blog.example.com/**
- 后台：**https://blog.example.com/admin**（首次管理员账密见脚本输出，登录后请修改）

---

## 三、关键配置说明

### 1) 反向代理（Nginx）
- `deploy/nginx-blog.conf`：`/static/` 由 Nginx 直接托管（缓存 7 天），其余流量反代到 `127.0.0.1:5000`。
- 应用（gunicorn）**仅监听回环地址**，不直接暴露公网；外部只经 Nginx 的 80/443 进入。
- `certbot --nginx` 会自动把 80 升级为 443 并加 HTTP→HTTPS 跳转。

### 2) 防火墙（UFW）
`deploy/ufw-setup.sh` 仅开放：
- `22/tcp` — SSH 管理
- `80/tcp` — HTTP（ACME 验证 + 跳转）
- `443/tcp` — HTTPS

其余入站一律拒绝。

### 3) 守护进程与日志（systemd）
- 自动重启：`Restart=always` + `RestartSec=5`
- 日志：`journalctl -u blog -f`（也可 `journalctl -u blog --since today`）
- 安全加固：`NoNewPrivileges`、`ProtectSystem=strict`、`ProtectHome=true`、`PrivateTmp=true`、`ReadWritePaths=/opt/blog`

### 4) 环境变量与敏感信息管理
- 所有密钥集中在 `/opt/blog/.env`，**权限 600、属主 blog**、且被 `.gitignore` 排除，永不入库。
- 脚本用 `openssl rand -hex` 生成 `SECRET_KEY / JWT_SECRET / 数据库密码 / 管理员密码`，无明文默认值。
- 查看/修改：`nano /opt/blog/.env` 后 `systemctl restart blog`。

### 5) HTTPS 证书续期
Certbot 安装时自带 systemd timer，证书到期前自动续期，**无需手动操作**。可验证：
```bash
sudo certbot renew --dry-run
```

---

## 四、部署后验证步骤

```bash
# 1) 健康检查（应有 {"ok":true,...}）
curl -s https://blog.example.com/api/health

# 2) 首页可访问（HTTP 应 301 跳转到 HTTPS）
curl -sI http://blog.example.com/ | head -1

# 3) 证书有效
echo | openssl s_client -connect blog.example.com:443 2>/dev/null | openssl x509 -noout -dates

# 4) 服务与日志
systemctl status blog --no-pager
journalctl -u blog -n 50 --no-pager

# 5) 防火墙
sudo ufw status

# 6) 浏览器实测：访问前台文章、/admin 登录发文
```

正常结果：① health 返回 `ok:true`；② HTTP 请求被 301 到 HTTPS；③ 证书 `notBefore/notAfter` 有效；④ `systemctl status blog` 为 `active (running)`；⑤ ufw 仅 22/80/443 开放。

---

## 五、后续更新代码

```bash
bash /opt/blog/deploy/deploy-update.sh
```
（拉取最新 → 重装依赖 → 重启服务；不中断 HTTPS）

---

## 六、可选：使用 SQLite 而非 PostgreSQL

若不想维护数据库服务，编辑 `deploy/setup-server.sh` 跳过第 5 步（PostgreSQL），并在第 6 步把 `.env` 中的 `DATABASE_URL` 改为 `sqlite:///blog.db`，同时把 `blog.service` 里的 `After=/Wants=postgresql.service` 两行删掉即可。

---

## 七、回滚

```bash
cd /opt/blog && sudo -u blog git checkout <旧commit>
systemctl restart blog
```
