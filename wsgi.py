# 生产入口：供 gunicorn / uwsgi 使用
# 用法：gunicorn -w 4 -b 0.0.0.0:5000 wsgi:app
from app import app, init_data

# 启动时建表并写入种子数据（使用 gunicorn --preload 可只执行一次）
try:
    init_data()
except Exception as e:  # 多 worker 并发时避免种子冲突导致崩溃
    import logging
    logging.getLogger("wsgi").warning("init_data 跳过或失败: %s", e)

if __name__ == "__main__":
    app.run()
