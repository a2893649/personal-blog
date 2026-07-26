#!/usr/bin/env bash
# ============================================================
# 一键部署脚本（在目标 Ubuntu 22.04 / 24.04 服务器上以 root 运行）
# 完成：依赖安装 → 代码克隆 → 虚拟环境 → PostgreSQL → systemd 守护进程
#        → Nginx 反代 → UFW 防火墙 → Let's Encrypt HTTPS
# 用法：
#   bash setup-server.sh <域名> <邮箱>
# 示例：
#   bash setup-server.sh blog.example.com admin@example.com
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "用法: bash setup-server.sh <域名> <邮箱>"
  echo "示例: bash setup-server.sh blog.example.com admin@example.com"
  exit 1
fi

REPO="https://github.com/a2893649/personal-blog.git"
APP_DIR="/opt/blog"
APP_USER="blog"
DB_NAME="blogdb"
DB_USER="blog_user"
DB_PASS="$(openssl rand -hex 16)"
SECRET="$(openssl rand -hex 32)"
JWT_SECRET="$(openssl rand -hex 32)"

echo "==> [1/8] 系统更新与依赖安装"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  python3 python3-venv python3-pip python3-dev \
  nginx ufw certbot python3-certbot-nginx \
  postgresql postgresql-contrib git curl openssl

echo "==> [2/8] 创建部署用户 $APP_USER"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

echo "==> [3/8] 克隆代码到 $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
fi

echo "==> [4/8] Python 虚拟环境 + 依赖"
sudo -u "$APP_USER" python3 -m venv "$APP_DIR/venv"
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install --upgrade pip -q
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" -q

echo "==> [5/8] 创建 PostgreSQL 数据库与用户"
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';" 2>/dev/null || echo "    (角色已存在，跳过)"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || echo "    (数据库已存在，跳过)"

echo "==> [6/8] 写入生产环境变量 /opt/blog/.env （权限 600）"
cat > "$APP_DIR/.env" <<ENV
SECRET_KEY=$SECRET
JWT_SECRET=$JWT_SECRET
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -hex 12)
ADMIN_EMAIL=$EMAIL
PORT=5000
CORS_ORIGINS=https://$DOMAIN
JWT_EXP_DAYS=7
ENV
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"
echo "    初始管理员密码已随机生成，登录 /admin 后请尽快修改（或改 .env 后重启）"

echo "==> [7/8] 安装 systemd 守护进程"
install -m 644 "$APP_DIR/deploy/blog.service" /etc/systemd/system/blog.service
systemctl daemon-reload
systemctl enable blog
systemctl restart blog
sleep 3
systemctl is-active --quiet blog && echo "    blog 服务运行中 OK" || { echo "    blog 启动失败，查看: journalctl -u blog"; exit 1; }

echo "==> [8/8] Nginx 反代 + 防火墙 + HTTPS"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx-blog.conf" > /etc/nginx/sites-available/blog
ln -sf /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/blog
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
bash "$APP_DIR/deploy/ufw-setup.sh"
echo "    申请 Let's Encrypt 证书（certbot 自动改写 nginx 加入 443 + 跳转）..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
  echo "    [WARN] 证书申请失败：请确认 $DOMAIN 的 A 记录已指向本机公网 IP，再运行："
  echo "       certbot --nginx -d $DOMAIN --redirect"
}

echo
echo "=========================================================="
echo " 部署完成！"
echo " 前台: https://$DOMAIN/"
echo " 后台: https://$DOMAIN/admin  (管理员: $ADMIN_USERNAME)"
echo " 健康检查: curl https://$DOMAIN/api/health"
echo " 日志: journalctl -u blog -f"
echo " HTTPS 自动续期已由 certbot 的 systemd timer 接管"
echo "=========================================================="
echo " 后续更新代码: bash $APP_DIR/deploy/deploy-update.sh"
