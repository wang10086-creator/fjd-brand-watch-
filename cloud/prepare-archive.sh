#!/usr/bin/env bash
# Optional archive dependencies must never interrupt monitoring or delivery.
set -eu
python3 -m pip install --quiet playwright==1.55.0 lxml==6.0.2 tinycss2==1.4.0
npm ci --prefix cloud/mirror-tool --ignore-scripts --no-audit --no-fund
node cloud/mirror-tool/prepare.mjs
if command -v google-chrome >/dev/null || command -v chromium >/dev/null; then
  echo 'SingleFile 与正常公开页面渲染组件已就绪'
else
  echo '系统浏览器不可用，保留正文重建和公开检索证据页面'
fi
