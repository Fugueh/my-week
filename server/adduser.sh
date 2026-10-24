#!/usr/bin/env bash
# 给熟人开一个账号：在服务器上的项目根目录执行  ./server/adduser.sh 名字 [--e2ee]
# 名字只能用小写字母、数字、- 和 _。会打印出这个人的令牌，发给 TA 填进 App 的「同步」里。
# 名单在 config/users.txt，一行一个「名字 令牌」；删掉那一行就停用（数据还在 data/users/名字/）。
# 改名单不用重启服务，下一次请求就生效。
#
# --e2ee：账号一开始就打开端到端加密。脚本在这台服务器上随机生成密钥，打印出恢复码（只显示这一次，
#   不会存到服务器上；服务器只记下密钥指纹）。你是知道恢复码的；不想让任何人（包括你）知道，
#   就不要加 --e2ee，让对方自己在页面「同步」里点「开启端到端加密」。
# --keyid 8位十六进制：给已经在别处生成好密钥的情况用（服务器只收指纹，不生成密钥），一般不用手写。
set -euo pipefail
cd "$(dirname "$0")/.."
usage() { echo "用法：$0 名字 [--e2ee | --keyid 8位十六进制]   （名字用小写字母、数字、- 和 _）"; exit 1; }
name="${1:-}"; [[ "$name" =~ ^[a-z0-9_-]{1,32}$ ]] || usage
shift; keyid=""; gen=0
while [ $# -gt 0 ]; do
  case "$1" in
    --e2ee) gen=1; shift ;;
    --keyid) keyid="${2:-}"; [[ "$keyid" =~ ^[0-9a-f]{8}$ ]] || { echo "--keyid 应该是 8 位小写十六进制"; exit 1; }; shift 2 ;;
    *) echo "不认识的参数：$1"; usage ;;
  esac
done
[ "$gen" = 1 ] && [ -n "$keyid" ] && { echo "--e2ee 和 --keyid 只能用一个"; exit 1; }

code=""
if [ "$gen" = 1 ]; then
  PY=""
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c "import hashlib" >/dev/null 2>&1; then PY="$c"; break; fi
  done
  [ -n "$PY" ] || { echo "服务器上找不到能用的 python3，没法生成密钥"; exit 1; }
  # 和 web/js/crypto.js 一致：32 字节随机密钥 → base32 的 52 个字符 + 2 位校验，四个一组；指纹是 SHA-256 前 4 字节
  read -r keyid code < <("$PY" - <<'PYEOF'
import hashlib, os
ALPH = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"
def b32(bs):
    bits = val = 0; out = ""
    for b in bs:
        val = (val << 8) | b; bits += 8
        while bits >= 5:
            out += ALPH[(val >> (bits - 5)) & 31]; bits -= 5
        val &= (1 << bits) - 1
    if bits > 0:
        out += ALPH[(val << (5 - bits)) & 31]
    return out
raw = os.urandom(32); h = hashlib.sha256(raw).digest()
s = b32(raw) + b32(h[:2])[:2]
print(h[:4].hex(), "-".join(s[i:i + 4] for i in range(0, len(s), 4)))
PYEOF
)
  [ -n "$keyid" ] && [ -n "$code" ] || { echo "生成密钥失败"; exit 1; }
fi

touch config/users.txt; chmod 600 config/users.txt
if grep -qE "^$name[[:space:]]" config/users.txt; then echo "已经有 $name 了，令牌在 config/users.txt 里"; exit 1; fi
token="$(openssl rand -hex 24)"
echo "$name $token" >> config/users.txt
mkdir -p "data/users/$name"
[ -n "$keyid" ] && printf '{"e2ee": true, "keyId": "%s"}' "$keyid" > "data/users/$name/.meta.json"
url="https://$(grep -E '^DOMAIN=' config/.env | cut -d= -f2)"
echo "已添加 $name"
echo "令牌：$token"
echo "服务器地址：$url"
if [ -n "$keyid" ]; then echo "端到端加密：已开启（密钥指纹 $keyid）"; fi
if [ -n "$code" ]; then
  echo "恢复码：$code"
  echo "（恢复码只显示这一次，服务器上没有存。请发给对方并让 TA 存进密码管理器；丢了而且所有设备也丢了，数据就解不开。）"
fi
echo "--- 可以直接发给 $name（私聊）---"
echo "网页：$url   安卓安装包：$url/download/my-week.apk"
echo "打开页面，滚到最底下的「同步」，填上令牌（在 App 里还要填服务器地址 $url）。"
exit 0
