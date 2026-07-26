#!/usr/bin/env bash
# 拉取最新代码并热重启（在目标服务器上以 root 运行）
set -euo pipefail
APP_DIR="/opt/blog"
cd "$APP_DIR"
sudo -u blog git pull --ff-only
sudo -u blog "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" -q
systemctl restart blog
systemctl is-active --quiet blog && echo "更新完成，blog 运行中 OK" || { echo "重启失败，查看 journalctl -u blog"; exit 1; }
