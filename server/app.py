"""我的一周 · 同步服务

只用 Python 标准库。提供两样东西：
  1. 静态页面（web/ 目录）
  2. /api/weeks —— 按周的 Markdown 文件，带版本号

数据就是 DATA_DIR 里的一个个 2026-W42.md，可以直接 ssh 上去改。
版本号 = 文件内容的 sha256 前 16 位，所以手动改了文件，版本号自然就变了。
每次被覆盖前，旧内容会留一份在 DATA_DIR/.history/ 里。

多用户
  MYWEEK_TOKEN 是主人的令牌，数据在 DATA_DIR 根目录。
  熟人写在 USERS_FILE 里，一行一个「名字 令牌」，数据在 DATA_DIR/users/名字/。
  这个文件改了会自动重新读，不用重启。用 server/adduser.sh 添加。

环境变量
  MYWEEK_TOKEN   主人的访问令牌（必填）
  USERS_FILE     熟人名单，默认 /config/users.txt（不存在就当没有）
  DATA_DIR       数据目录，默认 /data
  WEB_DIR        页面目录，默认 /app/web
  PORT           默认 8000
  KEEP_HISTORY   每周保留多少份历史，默认 50
  MAX_IMAGE      单张图片最大字节数，默认 4 MB
  IMAGE_QUOTA    每个人图片总量上限，默认 500 MB

图片
  /api/images/<id>：PUT 上传、GET 下载、DELETE 删除，存在账号目录的 images/ 里。
  图片是二进制，不进周文件；DELETE 就是真删，不进 .history，不留副本。
  开了端到端加密的账号只收密文（以 MYWEEK-E2EE/1 开头）。
"""
import hashlib, hmac, json, mimetypes, os, re, shutil, sys, time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse

TOKEN = os.environ.get("MYWEEK_TOKEN", "")
DATA = Path(os.environ.get("DATA_DIR", "/data"))
WEB = Path(os.environ.get("WEB_DIR", "/app/web")).resolve()
PORT = int(os.environ.get("PORT", "8000"))
KEEP = int(os.environ.get("KEEP_HISTORY", "50"))
MAX_IMAGE = int(os.environ.get("MAX_IMAGE", str(4 << 20)))
IMAGE_QUOTA = int(os.environ.get("IMAGE_QUOTA", str(500 << 20)))
USERS_FILE = Path(os.environ.get("USERS_FILE", "/config/users.txt"))
NAME_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
_users = {"mtime": None, "map": {}}  # 令牌 -> 名字


def users() -> dict:
    """读熟人名单；文件改过才重新读。"""
    try:
        m = USERS_FILE.stat().st_mtime
    except FileNotFoundError:
        _users.update(mtime=None, map={})
        return {}
    if m != _users["mtime"]:
        mp = {}
        for line in USERS_FILE.read_text(encoding="utf-8").splitlines():
            parts = line.split("#", 1)[0].split()
            if len(parts) == 2 and NAME_RE.match(parts[0]) and len(parts[1]) >= 16:
                mp[parts[1]] = parts[0]
        _users.update(mtime=m, map=mp)
    return _users["map"]
WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
IMAGE_RE = re.compile(r"^[A-Za-z0-9-]{4,48}$")  # 图片 ID；缩略图是 ID 后面加一个 t
MAX_BODY = 1 << 20  # 1 MB 一周，足够了
lock = Lock()       # 单用户，一把锁保证"检查版本 + 写入"是原子的


def version(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def week_path(base: Path, wid: str) -> Path:
    return base / f"{wid}.md"


def keep_history(base: Path, wid: str, old: bytes):
    d = base / ".history" / wid
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{time.strftime('%Y%m%d-%H%M%S')}-{version(old)}.md").write_bytes(old)
    files = sorted(d.glob("*.md"))
    for f in files[:-KEEP]:
        f.unlink()


def read_meta(base: Path) -> dict:
    """账号级的设置。目前只有端到端加密：{"e2ee": true, "keyId": "1a2b3c4d"}。"""
    try:
        return json.loads((base / ".meta.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {"e2ee": False}


class Handler(BaseHTTPRequestHandler):
    server_version = "myweek/1"

    # ---------- 小工具 ----------
    def send(self, code, body=b"", ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def cors(self):
        # 允许本地打开的页面（file:// 或 localhost）也能同步；数据靠令牌保护
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "ETag")

    def authed(self):
        """令牌对的话返回这个人的数据目录，否则回 401 并返回 None。"""
        got = self.headers.get("Authorization", "")
        tok = got[7:] if got.startswith("Bearer ") else ""
        if TOKEN and hmac.compare_digest(tok, TOKEN):
            return DATA
        for t, name in users().items():
            if hmac.compare_digest(tok, t):
                d = DATA / "users" / name
                d.mkdir(parents=True, exist_ok=True)
                return d
        self.send(HTTPStatus.UNAUTHORIZED, {"error": "令牌不对"})
        return None

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        self.send(HTTPStatus.NO_CONTENT)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.send(200, {"ok": True})
        if path == "/api/meta":
            base = self.authed()
            if not base:
                return
            return self.send(200, read_meta(base))
        if path == "/api/weeks":
            base = self.authed()
            if not base:
                return
            out = []
            for f in sorted(base.glob("*.md")):
                if WEEK_RE.match(f.stem):
                    out.append({"week": f.stem, "version": version(f.read_bytes())})
            return self.send(200, {"weeks": out})
        m = re.match(r"^/api/images/([^/]+)$", path)
        if m:
            return self.get_image(m.group(1))
        m = re.match(r"^/api/weeks/([^/]+)$", path)
        if m:
            base = self.authed()
            if not base:
                return
            wid = m.group(1)
            if not WEEK_RE.match(wid):
                return self.send(400, {"error": "周号格式应为 2026-W42"})
            f = week_path(base, wid)
            if not f.exists():
                return self.send(404, {"error": "没有这一周"})
            data = f.read_bytes()
            return self.send(200, data, "text/markdown; charset=utf-8", {"ETag": version(data)})
        return self.static(path)

    do_HEAD = do_GET

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/meta":
            return self.put_meta()
        m = re.match(r"^/api/images/([^/]+)$", path)
        if m:
            return self.put_image(m.group(1))
        m = re.match(r"^/api/weeks/([^/]+)$", path)
        if not m:
            return self.send(404, {"error": "没有这个地址"})
        base = self.authed()
        if not base:
            return
        wid = m.group(1)
        if not WEEK_RE.match(wid):
            return self.send(400, {"error": "周号格式应为 2026-W42"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self.send(413, {"error": "太大了"})
        body = self.rfile.read(n)
        try:
            body.decode("utf-8")
        except UnicodeDecodeError:
            return self.send(400, {"error": "不是 UTF-8 文本"})
        if read_meta(base).get("e2ee") and not body.startswith(b"MYWEEK-E2EE/1 "):
            # 开了加密的账号不收明文：防止一台还没装钥匙的设备把明文传上来
            return self.send(422, {"error": "这个账号开了端到端加密，服务器不收明文"})
        if_match = self.headers.get("If-Match")  # 客户端是基于哪个版本改的；新建时不带
        with lock:
            f = week_path(base, wid)
            cur = f.read_bytes() if f.exists() else None
            cur_v = version(cur) if cur is not None else None
            if cur is not None and if_match != cur_v and cur != body:
                # 服务器上的版本比客户端看到的新：交给客户端合并
                return self.send(409, {"error": "conflict", "version": cur_v, "text": cur.decode("utf-8")})
            if cur is not None and cur != body:
                # 开了加密以后，被覆盖的旧明文不进历史：服务器上一份明文都不留
                if not (read_meta(base).get("e2ee") and not cur.startswith(b"MYWEEK-E2EE/1 ")):
                    keep_history(base, wid, cur)
            if cur != body:
                tmp = f.with_suffix(".md.tmp")
                tmp.write_bytes(body)
                os.replace(tmp, f)  # 原子替换，写到一半断电也不会坏文件
        return self.send(200, {"week": wid, "version": version(body)}, headers={"ETag": version(body)})

    def do_DELETE(self):
        m = re.match(r"^/api/images/([^/]+)$", urlparse(self.path).path)
        if not m:
            return self.send(404, {"error": "没有这个地址"})
        base = self.authed()
        if not base:
            return
        iid = m.group(1)
        if not IMAGE_RE.match(iid):
            return self.send(400, {"error": "图片 ID 格式不对"})
        with lock:
            try:
                (base / "images" / iid).unlink()  # 真删：不进 .history，不留副本
            except FileNotFoundError:
                pass  # 本来就没有，也算删好了（重复删除没有副作用）
        return self.send(200, {"deleted": iid})

    def get_image(self, iid):
        base = self.authed()
        if not base:
            return
        if not IMAGE_RE.match(iid):
            return self.send(400, {"error": "图片 ID 格式不对"})
        try:
            data = (base / "images" / iid).read_bytes()
        except FileNotFoundError:
            return self.send(404, {"error": "没有这张图片"})
        ctype = "application/octet-stream" if data.startswith(b"MYWEEK-E2EE/1 ") else "image/jpeg"
        return self.send(200, data, ctype, {"Cache-Control": "private, no-store"})

    def drain(self, n):
        """把没打算收的请求体读掉再回错误：不然客户端还在发的时候连接被关，看到的是网络错误而不是 413 / 400。"""
        left = min(n, 32 << 20)
        while left > 0:
            chunk = self.rfile.read(min(left, 65536))
            if not chunk:
                break
            left -= len(chunk)

    def put_image(self, iid):
        base = self.authed()
        if not base:
            return
        n = int(self.headers.get("Content-Length") or 0)
        if not IMAGE_RE.match(iid):
            self.drain(n)
            return self.send(400, {"error": "图片 ID 格式不对"})
        if n > MAX_IMAGE:
            self.drain(n)
            return self.send(413, {"error": "图片太大了"})
        body = self.rfile.read(n)
        sealed = body.startswith(b"MYWEEK-E2EE/1 ")
        if read_meta(base).get("e2ee"):
            if not sealed:
                return self.send(422, {"error": "这个账号开了端到端加密，服务器不收明文图片"})
        elif not (sealed or body.startswith(b"\xff\xd8\xff")):
            return self.send(415, {"error": "只收 JPEG 图片"})
        d = base / "images"
        with lock:
            d.mkdir(parents=True, exist_ok=True)
            f = d / iid
            used = sum(p.stat().st_size for p in d.iterdir() if p.is_file() and p != f)
            if used + len(body) > IMAGE_QUOTA:
                return self.send(507, {"error": "图片总量超过了这个账号的上限"})
            tmp = d / (iid + ".tmp")
            tmp.write_bytes(body)
            os.replace(tmp, f)  # 原子替换
        return self.send(200, {"image": iid, "size": len(body)})

    def put_meta(self):
        base = self.authed()
        if not base:
            return
        n = int(self.headers.get("Content-Length") or 0)
        try:
            new = json.loads(self.rfile.read(min(n, 4096)) or b"{}")
        except ValueError:
            return self.send(400, {"error": "不是 JSON"})
        if not isinstance(new.get("e2ee"), bool) or (new["e2ee"] and not re.fullmatch(r"[0-9a-f]{8}", str(new.get("keyId", "")))):
            return self.send(400, {"error": "格式应为 {\"e2ee\": true, \"keyId\": \"8 位十六进制\"}"})
        with lock:
            cur = read_meta(base)
            if cur.get("e2ee") and new["e2ee"] and cur.get("keyId") != new["keyId"]:
                # 已经用一把钥匙加密了，不能被另一把悄悄换掉
                return self.send(409, {"error": "这个账号已经用另一把密钥加密了", **cur})
            if new["e2ee"] and not cur.get("e2ee"):
                # 开启加密：旧的明文历史版本全部删掉，服务器上不留明文
                shutil.rmtree(base / ".history", ignore_errors=True)
            meta = {"e2ee": new["e2ee"], **({"keyId": new["keyId"]} if new["e2ee"] else {})}
            (base / ".meta.json").write_text(json.dumps(meta), encoding="utf-8")
        return self.send(200, meta)

    # ---------- 静态文件 ----------
    def static(self, path):
        rel = path.lstrip("/") or "index.html"
        f = (WEB / rel).resolve()
        if WEB not in f.parents and f != WEB:
            return self.send(404, "not found", "text/plain")
        if f.is_dir():
            f = f / "index.html"
        if not f.is_file():
            return self.send(404, "not found", "text/plain")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix == ".webmanifest":
            ctype = "application/manifest+json"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/manifest+json"):
            ctype += "; charset=utf-8"
        size = f.stat().st_size
        if size <= 1 << 20:
            # 页面和脚本每次都让浏览器问一下有没有更新；离线时由 service worker 兜底
            return self.send(200, f.read_bytes(), ctype, {"Cache-Control": "no-cache"})
        # 大文件（/download/ 里的安装包，Windows 版有一百多 MB）：边读边发，不整个读进内存
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-cache")
        self.cors()
        self.end_headers()
        if self.command != "HEAD":
            with f.open("rb") as src:
                shutil.copyfileobj(src, self.wfile, 1 << 20)


def drop_root():
    """以 root 启动时，换成 data 目录主人的身份运行，这样写出来的 .md 你自己能直接改。"""
    if hasattr(os, "getuid") and os.getuid() == 0:
        st = DATA.stat()
        if st.st_uid != 0:
            os.setgid(st.st_gid)
            os.setuid(st.st_uid)


def main():
    if not TOKEN:
        sys.exit("请设置环境变量 MYWEEK_TOKEN")
    DATA.mkdir(parents=True, exist_ok=True)
    drop_root()
    print(f"我的一周 · 同步服务 :{PORT}  数据 {DATA}  页面 {WEB}  熟人 {len(users())} 位", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
