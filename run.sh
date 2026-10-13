#!/bin/sh
set -eu

warroom_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '启动失败：请先安装 Node.js 20 或以上版本。' >&2
  exit 1
fi

warroom_node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$warroom_node_major" -lt 20 ]; then
  printf '%s\n' '启动失败：需要 Node.js 20 或以上版本。' >&2
  exit 1
fi

cd "$warroom_root"
exec node "$warroom_root/web/server.js"
