#!/usr/bin/env bash
# Optional archive dependencies must never interrupt monitoring or delivery.
set -eu
python3 -m pip install --quiet playwright==1.55.0
if ! fc-match -f '%{family}' ':lang=zh' | grep -Eqi 'Noto|CJK|WenQuanYi'; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq fonts-noto-cjk fonts-noto-core
fi
if command -v google-chrome >/dev/null || command -v chromium >/dev/null; then
  echo '页面正常渲染与 PDF 组件已就绪'
else
  echo '系统浏览器不可用，保留静态正文和索引摘要'
fi
