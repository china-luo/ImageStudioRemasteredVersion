#!/bin/bash
# 打包 macOS 应用（arm64 + x64 的 dmg 与 zip）
# 前置: npm install 完成、已执行 npm run build 产出 dist/
# 用法: bash scripts/package-mac-app.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packaging requires running on macOS." >&2
  exit 1
fi

ICON_PNG="build/icon.png"
ICON_ICNS="build/icon.icns"

if [[ ! -f "$ICON_PNG" ]]; then
  echo "App icon source was not found: $ICON_PNG" >&2
  exit 1
fi

# icon.icns 缺失或比源图旧时重新生成
if [[ ! -f "$ICON_ICNS" || "$ICON_PNG" -nt "$ICON_ICNS" ]]; then
  bash scripts/create-mac-icon.sh -SourcePng "$ICON_PNG" -OutIcns "$ICON_ICNS"
fi

ELECTRON_APP="node_modules/electron/dist/Electron.app"
if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Electron runtime was not found at $ELECTRON_APP. Run npm install first." >&2
  exit 1
fi

if [[ ! -d "dist" ]]; then
  echo "dist/ was not found. Run npm run build first." >&2
  exit 1
fi

if [[ ! -x "node_modules/.bin/electron-builder" ]]; then
  echo "electron-builder was not found. Run npm install first." >&2
  exit 1
fi

# 未配置签名证书时跳过签名（本机构建可用；对外分发需配置签名 + 公证）
EXTRA_ARGS=()
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
  echo "No 'Developer ID Application' identity found; building unsigned (ad-hoc) artifacts."
  EXTRA_ARGS+=(--publish never)
fi

npx electron-builder --mac --config electron-builder.mac.yml "${EXTRA_ARGS[@]}"

echo
echo "macOS artifacts:"
find release -maxdepth 1 \( -name '*.dmg' -o -name '*.zip' \) -newer package.json -print 2>/dev/null || \
  find release -maxdepth 1 \( -name '*.dmg' -o -name '*.zip' \) -print
