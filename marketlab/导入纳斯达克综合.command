#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ -x "$HOME/.marketlab/model-python" ]; then
  runtime="$HOME/.marketlab/model-python"
elif [ -x ".venv/bin/python" ]; then
  runtime=".venv/bin/python"
else
  echo '未找到模型运行环境，请按 docs/模型与复现.md 中的步骤安装依赖。'
  exit 1
fi
exec "$runtime" model/import_csi300.py --market NASDAQ:IXIC --choose --open
