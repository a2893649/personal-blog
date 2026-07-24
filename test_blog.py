import urllib.request, json, os
B = os.environ.get("BLOG_TEST_URL", "http://127.0.0.1:5000")

def call(path, method="GET", data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(B + path, data=body, headers=headers, method=method)
    try:
        r = urllib.request.urlopen(req)
        return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))

print("health:", call("/api/health"))
st, pl = call("/api/posts")
print("posts:", st, "total=", pl.get("total"))
print("admin-no-token (expect 403):", call("/api/admin/posts"))
s, u = call("/api/auth/login", "POST", {"username": "admin", "password": "admin123"})
print("admin login:", s, "is_admin=", u.get("user", {}).get("is_admin"))
tok = u["token"]
print("me:", call("/api/auth/me", token=tok)[1].get("user", {}).get("username"))
print("admin posts (with token):", call("/api/admin/posts", token=tok)[0])
cr, cd = call("/api/admin/posts", "POST",
              {"title": "JWT测试文章", "content": "# hi\n\n```js\nlet a=1\n```",
               "category": "技术", "tags": ["Python"], "status": "published"}, tok)
print("create:", cr, cd)
sr, sd = call("/api/auth/register", "POST",
              {"username": "alice", "password": "secret1", "email": "a@b.com", "display_name": "Alice"})
print("register alice:", sr, sd.get("user", {}).get("username"))
print("alice admin (expect 403):", call("/api/admin/posts", token=sd.get("token")))
print("about head:", call("/api/about")[1].get("content", "")[:20])
