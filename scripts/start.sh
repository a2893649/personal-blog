#!/usr/bin/env bash
# 容器/服务器启动脚本：初始化数据后启动 gunicorn
set -e

# 数据库初始化（建表 + 种子数据）。gunicorn 使用 --preload 时也已执行，
# 此处再次确保即使直接运行本脚本也能初始化。
python -c "import app; app.init_data()" || echo "init_data 跳过（可能已在 preload 阶段完成）"

exec gunicorn -w "${GUNICORN_WORKERS:-4}" --preload -b 0.0.0.0:"${PORT:-5000}" wsgi:app
