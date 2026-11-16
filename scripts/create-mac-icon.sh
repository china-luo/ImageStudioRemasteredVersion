#!/bin/bash
# 从 build/icon.png 生成 build/icon.icns（macOS 应用图标）
# 用法: bash scripts/create-mac-icon.sh [-SourcePng build/icon.png] [-OutIcns build/icon.icns]
set -euo pipefail

SOURCE_PNG="build/icon.png"
OUT_ICNS="build/icon.icns"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -SourcePng) SOURCE_PNG="$2"; shift 2 ;;
    -OutIcns) OUT_ICNS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

for tool in sips iconutil; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required (bundled with macOS)." >&2
    exit 1
  fi
done

if [[ ! -f "$SOURCE_PNG" ]]; then
  echo "Icon source was not found: $SOURCE_PNG" >&2
  exit 1
fi

ICONSET_DIR="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET_DIR"

sizes=(16 32 128 256 512)
for size in "${sizes[@]}"; do
  sips -z "$size" "$size" "$SOURCE_PNG" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$SOURCE_PNG" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

rm -f "$OUT_ICNS"
iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"
rm -rf "$(dirname "$ICONSET_DIR")"

echo "ICON_ICNS=$OUT_ICNS"
