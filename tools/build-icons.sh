#!/bin/bash
#
# Собирает иконки из assets/icon.svg:
#   assets/icon-512.png, assets/icon-192.png, assets/icon-180.png, assets/favicon.png
#   build/AppIcon.icns  — для приложения в Dock
#
# Нужен только macOS: sips + iconutil, а растрирует SVG headless Chrome.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$ROOT/assets/icon.svg"
BUILD="$ROOT/build"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Не найден Google Chrome: $CHROME" >&2
  echo "Он нужен только для растрирования SVG. Откройте icon.svg в браузере и сохраните PNG вручную." >&2
  exit 1
fi

echo "→ Растрирую SVG в 1024×1024"
cat > "$WORK/icon.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block}</style>
<img src="file://$SVG" width="1024" height="1024" alt="">
HTML

"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1024,1024 \
  --default-background-color=00000000 \
  --screenshot="$WORK/icon-1024.png" "file://$WORK/icon.html" >/dev/null 2>&1

if [ ! -f "$WORK/icon-1024.png" ]; then
  echo "Chrome не смог отрисовать иконку" >&2
  exit 1
fi

echo "→ Готовлю PNG для браузера"
mkdir -p "$BUILD"
cp "$WORK/icon-1024.png" "$BUILD/icon-1024.png"
sips -z 512 512 "$WORK/icon-1024.png" --out "$ROOT/assets/icon-512.png" >/dev/null
sips -z 192 192 "$WORK/icon-1024.png" --out "$ROOT/assets/icon-192.png" >/dev/null
sips -z 180 180 "$WORK/icon-1024.png" --out "$ROOT/assets/icon-180.png" >/dev/null
sips -z 32 32 "$WORK/icon-1024.png" --out "$ROOT/assets/favicon.png" >/dev/null

echo "→ Собираю AppIcon.icns"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  if [ "$size" -ne 512 ]; then
    sips -z "$size" "$size" "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  else
    sips -z 512 512 "$WORK/icon-1024.png" --out "$ICONSET/icon_512x512.png" >/dev/null
  fi
done
cp "$WORK/icon-1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$BUILD/AppIcon.icns"

echo "Готово:"
echo "  assets/icon-512.png  assets/icon-192.png  assets/icon-180.png  assets/favicon.png"
echo "  build/AppIcon.icns"
