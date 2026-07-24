#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人博客（生产可部署版）
技术栈：Flask + Flask-SQLAlchemy + JWT + SQLite/PostgreSQL

特性：
- 用户注册 / 登录（JWT 无状态鉴权）
- 管理员后台（文章、分类、标签、关于页管理）
- 公开 API：文章列表/详情、标签、分类、关于、搜索、筛选
- 数据库通过环境变量 DATABASE_URL 配置（默认 SQLite，生产用 PostgreSQL）
- 同一进程同时提供 REST API 与静态前端（SPA）

部署参见 DEPLOYMENT.md
"""
import os
import re
import jwt
from datetime import datetime, timedelta

from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

# 自动加载 .env（若存在），使本地运行 `python app.py` / gunicorn 时也能读取环境变量
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ---------------------------------------------------------------------------
# 基础配置
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-please-change")
JWT_SECRET = os.environ.get("JWT_SECRET", SECRET_KEY)
JWT_EXP_DAYS = int(os.environ.get("JWT_EXP_DAYS", "7"))
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "sqlite:///" + os.path.join(BASE_DIR, "blog.db")
)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config.update(
    SECRET_KEY=SECRET_KEY,
    SQLALCHEMY_DATABASE_URI=DATABASE_URL,
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MAX_CONTENT_LENGTH=8 * 1024 * 1024,
)
cors_setting = os.environ.get("CORS_ORIGINS", "*")
if cors_setting.strip() == "*":
    CORS(app)
else:
    CORS(app, origins=[o.strip() for o in cors_setting.split(",") if o.strip()])
db = SQLAlchemy(app)

# ---------------------------------------------------------------------------
# 模型
# ---------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(160), unique=True, nullable=True, index=True)
    password_hash = db.Column(db.String(200), nullable=False)
    display_name = db.Column(db.String(80))
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.String(40))


class Category(db.Model):
    __tablename__ = "categories"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    slug = db.Column(db.String(120))


class Tag(db.Model):
    __tablename__ = "tags"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    slug = db.Column(db.String(120))


class Article(db.Model):
    __tablename__ = "articles"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    summary = db.Column(db.Text)
    content = db.Column(db.Text)
    category_id = db.Column(
        db.Integer, db.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    status = db.Column(db.String(20), default="published")
    cover_image = db.Column(db.String(300))
    created_at = db.Column(db.String(40))
    updated_at = db.Column(db.String(40))
    published_at = db.Column(db.String(40))
    category = db.relationship("Category")
    tags = db.relationship("Tag", secondary="article_tags", backref="articles")


class ArticleTag(db.Model):
    __tablename__ = "article_tags"
    article_id = db.Column(
        db.Integer, db.ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id = db.Column(
        db.Integer, db.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class Setting(db.Model):
    __tablename__ = "settings"
    key = db.Column(db.String(80), primary_key=True)
    value = db.Column(db.Text)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now().isoformat()


def slugify(text):
    text = (text or "").strip().lower()
    text = re.sub(r"[\s]+", "-", text)
    text = re.sub(r"[^a-z0-9\u4e00-\u9fa5\-]", "", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "untitled"


def make_token(user):
    payload = {
        "uid": user.id,
        "adm": bool(user.is_admin),
        "exp": datetime.utcnow() + timedelta(days=JWT_EXP_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def public_user(u):
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name or u.username,
        "email": u.email,
        "is_admin": bool(u.is_admin),
    }


def current_user():
    h = request.headers.get("Authorization", "")
    if not h.startswith("Bearer "):
        return None
    try:
        data = jwt.decode(h[7:], JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None
    return db.session.get(User, data["uid"])


def admin_required(f):
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        u = current_user()
        if not u or not u.is_admin:
            return jsonify(error="需要管理员权限"), 403
        return f(*args, **kwargs)

    return wrapper


def serialize_post(a, with_tags=True):
    cat = a.category
    data = {
        "id": a.id,
        "title": a.title,
        "summary": a.summary,
        "category": {"id": cat.id, "name": cat.name, "slug": cat.slug} if cat else None,
        "status": a.status,
        "cover_image": a.cover_image,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
        "published_at": a.published_at,
    }
    if with_tags:
        data["tags"] = [{"id": t.id, "name": t.name, "slug": t.slug} for t in a.tags]
    return data


# ---------------------------------------------------------------------------
# 页面路由
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin")
@app.route("/admin/")
def admin_page():
    return render_template("admin.html")


@app.route("/api/health")
def health():
    return jsonify(ok=True, time=now_iso())


# ---------------------------------------------------------------------------
# 鉴权 API（公开）
# ---------------------------------------------------------------------------
@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip() or None
    display_name = (data.get("display_name") or "").strip() or username
    if len(username) < 3:
        return jsonify(error="用户名至少 3 个字符"), 400
    if len(password) < 6:
        return jsonify(error="密码至少 6 位"), 400
    if User.query.filter_by(username=username).first():
        return jsonify(error="用户名已存在"), 409
    if email and User.query.filter_by(email=email).first():
        return jsonify(error="邮箱已被注册"), 409
    u = User(
        username=username,
        email=email,
        password_hash=generate_password_hash(password),
        display_name=display_name,
        is_admin=False,
        created_at=now_iso(),
    )
    db.session.add(u)
    db.session.commit()
    return jsonify(ok=True, token=make_token(u), user=public_user(u)), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    ident = (data.get("username") or "").strip()
    password = data.get("password") or ""
    u = User.query.filter(
        (User.username == ident) | (User.email == ident)
    ).first()
    if u and check_password_hash(u.password_hash, password):
        return jsonify(ok=True, token=make_token(u), user=public_user(u))
    return jsonify(error="用户名或密码错误"), 401


@app.route("/api/auth/me")
def auth_me():
    u = current_user()
    if not u:
        return jsonify(user=None)
    return jsonify(user=public_user(u))


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    # JWT 为无状态令牌，客户端丢弃即可；此处仅作占位
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------
def _post_query(filters):
    q = Article.query.options(
        db.joinedload(Article.category), db.joinedload(Article.tags)
    )
    q = q.filter(Article.status == "published")
    if filters.get("tag"):
        q = q.join(ArticleTag).join(Tag).filter(Tag.slug == filters["tag"])
    if filters.get("category"):
        q = q.join(Category, Article.category_id == Category.id).filter(
            Category.slug == filters["category"]
        )
    if filters.get("q"):
        like = f"%{filters['q']}%"
        q = q.filter(
            db.or_(
                Article.title.like(like),
                Article.summary.like(like),
                Article.content.like(like),
            )
        )
    return q


@app.route("/api/posts")
def api_posts():
    page = int(request.args.get("page", 1))
    per_page = min(int(request.args.get("per_page", 10)), 50)
    filters = {
        "tag": request.args.get("tag"),
        "category": request.args.get("category"),
        "q": request.args.get("q", "").strip(),
    }
    q = _post_query(filters)
    total = q.count()
    pagination = q.order_by(Article.published_at.desc(), Article.id.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    posts = [serialize_post(a) for a in pagination.items]
    return jsonify(
        posts=posts,
        page=page,
        per_page=per_page,
        total=total,
        total_pages=pagination.pages or 1,
    )


@app.route("/api/posts/<int:pid>")
def api_post_detail(pid):
    a = Article.query.options(
        db.joinedload(Article.category), db.joinedload(Article.tags)
    ).get(pid)
    if not a or a.status != "published":
        return jsonify(error="文章不存在"), 404
    return jsonify(serialize_post(a))


@app.route("/api/categories")
def api_categories():
    rows = (
        db.session.query(
            Category.id,
            Category.name,
            Category.slug,
            db.func.count(Article.id)
            .filter(Article.status == "published")
            .label("count"),
        )
        .outerjoin(Article, Article.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.name)
        .all()
    )
    return jsonify(
        [{"id": r.id, "name": r.name, "slug": r.slug, "count": r.count} for r in rows]
    )


@app.route("/api/tags")
def api_tags():
    rows = (
        db.session.query(
            Tag.id,
            Tag.name,
            Tag.slug,
            db.func.count(ArticleTag.article_id).label("count"),
        )
        .outerjoin(ArticleTag, ArticleTag.tag_id == Tag.id)
        .group_by(Tag.id)
        .order_by(Tag.name)
        .all()
    )
    # 仅统计已发布文章中的使用数
    pub_ids = {a.id for a in Article.query.filter_by(status="published").all()}
    result = []
    for r in rows:
        used = (
            db.session.query(ArticleTag)
            .join(Article, Article.id == ArticleTag.article_id)
            .filter(ArticleTag.tag_id == r.id, Article.status == "published")
            .count()
        )
        result.append({"id": r.id, "name": r.name, "slug": r.slug, "count": used})
    return jsonify(result)


@app.route("/api/about")
def api_about():
    s = Setting.query.get("about")
    return jsonify(content=s.value if s else "")


# ---------------------------------------------------------------------------
# 管理 API（需管理员 JWT）
# ---------------------------------------------------------------------------
def _resolve_category(name):
    if not name:
        return None
    c = Category.query.filter_by(name=name).first()
    if c:
        return c
    c = Category(name=name, slug=slugify(name))
    db.session.add(c)
    db.session.flush()
    return c


def _resolve_tags(names):
    out = []
    for name in names or []:
        name = name.strip()
        if not name:
            continue
        t = Tag.query.filter_by(name=name).first()
        if not t:
            t = Tag(name=name, slug=slugify(name))
            db.session.add(t)
            db.session.flush()
        out.append(t)
    return out


@app.route("/api/admin/posts", methods=["GET"])
@admin_required
def admin_posts():
    posts = (
        Article.query.options(
            db.joinedload(Article.category), db.joinedload(Article.tags)
        )
        .order_by(Article.published_at.desc(), Article.id.desc())
        .all()
    )
    out = []
    for p in posts:
        d = serialize_post(p, with_tags=False)
        d["tags"] = [t.name for t in p.tags]
        out.append(d)
    return jsonify(out)


@app.route("/api/admin/posts", methods=["POST"])
@admin_required
def admin_post_create():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify(error="标题不能为空"), 400
    content = data.get("content") or ""
    summary = (data.get("summary") or "").strip() or content[:120].replace("\n", " ").strip()
    status = data.get("status") or "published"
    ts = now_iso()
    a = Article(
        title=title,
        summary=summary,
        content=content,
        category=_resolve_category(data.get("category")),
        status=status,
        cover_image=data.get("cover_image"),
        created_at=ts,
        updated_at=ts,
        published_at=data.get("published_at") or ts,
    )
    a.tags = _resolve_tags(data.get("tags"))
    db.session.add(a)
    db.session.commit()
    return jsonify(ok=True, id=a.id)


@app.route("/api/admin/posts/<int:pid>", methods=["PUT"])
@admin_required
def admin_post_update(pid):
    data = request.get_json(silent=True) or {}
    a = Article.query.get(pid)
    if not a:
        return jsonify(error="文章不存在"), 404
    if data.get("title") is not None:
        a.title = (data.get("title") or "").strip() or a.title
    if data.get("content") is not None:
        a.content = data.get("content")
    if "summary" in data:
        a.summary = (data.get("summary") or "").strip() or (
            a.content[:120].replace("\n", " ").strip() if a.content else ""
        )
    if data.get("status") is not None:
        a.status = data.get("status")
    if data.get("published_at") is not None:
        a.published_at = data.get("published_at")
    if data.get("category") is not None:
        a.category = _resolve_category(data.get("category"))
    if data.get("cover_image") is not None:
        a.cover_image = data.get("cover_image")
    if "tags" in data:
        a.tags = _resolve_tags(data.get("tags"))
    a.updated_at = now_iso()
    db.session.commit()
    return jsonify(ok=True, id=pid)


@app.route("/api/admin/posts/<int:pid>", methods=["DELETE"])
@admin_required
def admin_post_delete(pid):
    a = Article.query.get(pid)
    if not a:
        return jsonify(error="文章不存在"), 404
    db.session.delete(a)
    db.session.commit()
    return jsonify(ok=True)


# 分类
@app.route("/api/admin/categories", methods=["GET"])
@admin_required
def admin_categories():
    rows = (
        db.session.query(Category, db.func.count(Article.id).label("count"))
        .outerjoin(Article, Article.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.name)
        .all()
    )
    return jsonify(
        [{"id": c.id, "name": c.name, "slug": c.slug, "count": count} for c, count in rows]
    )


@app.route("/api/admin/categories", methods=["POST"])
@admin_required
def admin_category_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="名称不能为空"), 400
    if Category.query.filter_by(name=name).first():
        return jsonify(error="分类已存在"), 409
    db.session.add(Category(name=name, slug=slugify(name)))
    db.session.commit()
    return jsonify(ok=True)


@app.route("/api/admin/categories/<int:cid>", methods=["PUT"])
@admin_required
def admin_category_update(cid):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="名称不能为空"), 400
    c = Category.query.get(cid)
    if not c:
        return jsonify(error="分类不存在"), 404
    if Category.query.filter(Category.name == name, Category.id != cid).first():
        return jsonify(error="分类已存在"), 409
    c.name = name
    c.slug = slugify(name)
    db.session.commit()
    return jsonify(ok=True)


@app.route("/api/admin/categories/<int:cid>", methods=["DELETE"])
@admin_required
def admin_category_delete(cid):
    c = Category.query.get(cid)
    if not c:
        return jsonify(error="分类不存在"), 404
    db.session.delete(c)
    db.session.commit()
    return jsonify(ok=True)


# 标签
@app.route("/api/admin/tags", methods=["GET"])
@admin_required
def admin_tags():
    rows = (
        db.session.query(Tag, db.func.count(ArticleTag.article_id).label("count"))
        .outerjoin(ArticleTag, ArticleTag.tag_id == Tag.id)
        .group_by(Tag.id)
        .order_by(Tag.name)
        .all()
    )
    return jsonify(
        [{"id": t.id, "name": t.name, "slug": t.slug, "count": count} for t, count in rows]
    )


@app.route("/api/admin/tags", methods=["POST"])
@admin_required
def admin_tag_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="名称不能为空"), 400
    if Tag.query.filter_by(name=name).first():
        return jsonify(error="标签已存在"), 409
    db.session.add(Tag(name=name, slug=slugify(name)))
    db.session.commit()
    return jsonify(ok=True)


@app.route("/api/admin/tags/<int:tid>", methods=["PUT"])
@admin_required
def admin_tag_update(tid):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="名称不能为空"), 400
    t = Tag.query.get(tid)
    if not t:
        return jsonify(error="标签不存在"), 404
    if Tag.query.filter(Tag.name == name, Tag.id != tid).first():
        return jsonify(error="标签已存在"), 409
    t.name = name
    t.slug = slugify(name)
    db.session.commit()
    return jsonify(ok=True)


@app.route("/api/admin/tags/<int:tid>", methods=["DELETE"])
@admin_required
def admin_tag_delete(tid):
    t = Tag.query.get(tid)
    if not t:
        return jsonify(error="标签不存在"), 404
    db.session.delete(t)
    db.session.commit()
    return jsonify(ok=True)


# 关于页
@app.route("/api/admin/about", methods=["GET"])
@admin_required
def admin_about_get():
    s = Setting.query.get("about")
    return jsonify(content=s.value if s else "")


@app.route("/api/admin/about", methods=["PUT"])
@admin_required
def admin_about_update():
    data = request.get_json(silent=True) or {}
    db.session.merge(Setting(key="about", value=data.get("content") or ""))
    db.session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# 初始化（建表 + 种子数据）
# ---------------------------------------------------------------------------
def init_data():
    with app.app_context():
        db.create_all()
        if User.query.count() == 0:
            admin_user = os.environ.get("ADMIN_USERNAME", "admin")
            admin_pass = os.environ.get("ADMIN_PASSWORD", "admin123")
            admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
            db.session.add(
                User(
                    username=admin_user,
                    email=admin_email,
                    password_hash=generate_password_hash(admin_pass),
                    display_name="站长",
                    is_admin=True,
                    created_at=now_iso(),
                )
            )
        if Category.query.count() == 0:
            db.session.add_all([
                Category(name="技术", slug=slugify("技术")),
                Category(name="随笔", slug=slugify("随笔")),
            ])
        if Tag.query.count() == 0:
            db.session.add_all([
                Tag(name="Python", slug=slugify("Python")),
                Tag(name="Flask", slug=slugify("Flask")),
                Tag(name="前端", slug=slugify("前端")),
            ])
        if Article.query.count() == 0:
            ts = now_iso()
            a1 = Article(
                title="欢迎来到我的个人博客",
                summary="这是使用 Flask + 原生 JavaScript 搭建的轻量级博客，支持 Markdown 富文本与代码高亮。",
                content="# 欢迎\n\n这是一个**示例文章**，用来演示博客的基本能力。\n\n## 代码高亮\n\n```python\ndef hello(name: str) -> str:\n    return f\"Hello, {name}!\"\n```\n\n## 列表\n\n- 支持 *Markdown*\n- 支持 `行内代码`\n- 支持 [链接](https://flask.palletsprojects.com)\n",
                category_id=1, status="published", created_at=ts, updated_at=ts, published_at=ts,
            )
            a2 = Article(
                title="第二篇：前端响应式的几点思考",
                summary="简单聊聊移动端适配与响应式布局的一些实践经验。",
                content="# 响应式布局\n\n使用 *CSS Grid* 与 *Flexbox* 可以很方便地做响应式。\n\n```css\n.container {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));\n  gap: 1rem;\n}\n```\n",
                category_id=1, status="published", created_at=ts, updated_at=ts, published_at=ts,
            )
            db.session.add_all([a1, a2])
            db.session.flush()
            db.session.add(ArticleTag(article_id=a1.id, tag_id=1))
            db.session.add(ArticleTag(article_id=a1.id, tag_id=2))
            db.session.add(ArticleTag(article_id=a2.id, tag_id=3))
        if not Setting.query.get("about"):
            db.session.add(Setting(key="about", value=(
                "# 关于我\n\n你好，我是这个博客的站长。\n\n"
                "平时喜欢折腾技术与自动化工具，这个博客用来记录学习笔记与生活随笔。\n\n"
                "## 联系方式\n\n- 邮箱：admin@example.com\n"
            )))
        db.session.commit()


if __name__ == "__main__":
    init_data()
    port = int(os.environ.get("PORT", os.environ.get("BLOG_PORT", 5000)))
    app.run(host="0.0.0.0", port=port, debug=False)
