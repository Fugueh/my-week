#!/usr/bin/env bash
# 给熟人开一个账号：在服务器上的项目根目录执行  ./server/adduser.sh 名字
# 名字只能用小写字母、数字、- 和 _。会打印出这个人的令牌，发给 TA 填进 App 的「同步」里。
# 名单在 config/users.txt，一行一个「名字 令牌」；删掉那一行就停用（数据还在 data/users/名字/）。
# 改名单不用重启服务，下一次请求就生效。
set -euo pipefail
cd "$(dirname "$0")/.."
name="${1:-}"
[[ "$name" =~ ^[a-z0-9_-]{1,32}$ ]] || { echo "用法：$0 名字   （小写字母、数字、- 和 _）"; exit 1; }
touch config/users.txt; chmod 600 config/users.txt
if grep -qE "^$name[[:space:]]" config/users.txt; then echo "已经有 $name 了，令牌在 config/users.txt 里"; exit 1; fi
token="$(openssl rand -hex 24)"
echo "$name $token" >> config/users.txt
mkdir -p "data/users/$name"
echo "已添加 $name"
echo "令牌：$token"
echo "服务器地址：https://$(grep -E '^DOMAIN=' config/.env | cut -d= -f2)"
