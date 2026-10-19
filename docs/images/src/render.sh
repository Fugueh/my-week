#!/usr/bin/env bash
# 重新生成 README「快速上手」的两张图：docs/images/quickstart-week.png、quickstart-day.png。
# 在项目根目录的 Git Bash 里执行：bash docs/images/src/render.sh
# 需要 Python 3 和 Microsoft Edge（Windows 自带）。不碰你自己的数据：页面、同步服务、浏览器资料都用临时目录。
set -euo pipefail
cd "$(dirname "$0")/../../.."
EDGE="${EDGE:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
PORT=8767 TOKEN=quickstart-demo-token
TMP="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null || true; rm -rf "$TMP"' EXIT

cp -r web "$TMP/web" && cp docs/images/src/quickstart.html "$TMP/web/_quickstart.html"
mkdir -p "$TMP/data"
MYWEEK_TOKEN=$TOKEN DATA_DIR="$TMP/data" WEB_DIR="$TMP/web" USERS_FILE=/nonexistent PORT=$PORT \
  python -X utf8 server/app.py > "$TMP/server.log" 2>&1 & SRV=$!
for i in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/api/health" && break; sleep 0.2; done

shot() {   # 视图 宽 高
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$(cygpath -w "$TMP/profile-$1")" \
    --force-device-scale-factor=2 --window-size="$2,$3" --virtual-time-budget=15000 \
    --screenshot="$(cygpath -w "$PWD/docs/images/quickstart-$1.png")" \
    "http://localhost:$PORT/_quickstart.html?view=$1&token=$TOKEN" 2>/dev/null
  echo "docs/images/quickstart-$1.png"
}
shot week 1080 1260
shot day 1080 740
