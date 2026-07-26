#!/usr/bin/env bash
# 防火墙：仅开放必要端口（22=SSH 管理 / 80=HTTP+ACME / 443=HTTPS）
# 在目标服务器上以 root 运行（setup-server.sh 会调用本脚本）
set -euo pipefail
echo "=== 安装并配置 UFW 防火墙（仅 22/80/443）==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ufw
ufw --force reset          # 清空旧规则，避免冲突
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH 管理'
ufw allow 80/tcp  comment 'HTTP / ACME 验证'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
echo "--- 当前规则 ---"
ufw status verbose
