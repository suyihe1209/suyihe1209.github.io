#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ -d "../../个人预览数据/markets" ]; then
  export MARKETLAB_MARKETS_DIR="$PWD/../../个人预览数据/markets"
  exec python3 server.py --port 18765 --open
fi
exec python3 server.py --open
