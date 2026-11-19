#!/bin/bash
#
# Собирает иконки из SVG:
#   assets/icon.svg           → assets/icon-512.png, icon-192.png, icon-180.png, favicon.png
#   assets/icon-maskable.svg  → assets/icon-maskable-512.png
#   build/AppIcon.icns        — для приложения в Dock
#
# Нужен только macOS: sips + iconutil, а растрирует SVG headless Chrome.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Не найден Google Chrome: $CHROME" >&2
  echo "Он нужен только для растрирования SVG. Откройте SVG в браузере и сохраните PNG вручную." >&2
  exit 1
fi

# $1 — путь к SVG, $2 — путь к PNG 1024×1024
render_svg() {
  local svg="$1" out="$2" page="$WORK/page.html"
  local bg="00000000"
  case "$svg" in
    *maskable*) bg="FF000000" ;;   # маскируемая иконка должна быть непрозрачной
  esac
  cat > "$page" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block}</style>
<img src="file://$svg" width="1024" height="1024" alt="">
HTML
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1024,1024 \
    --default-background-color="$bg" \
    --screenshot="$out" "file://$page" >/dev/null 2>&1
  [ -f "$out" ] || { echo "Chrome не смог отрисовать $svg" >&2; exit 1; }
}

echo "→ Растрирую SVG"
render_svg "$ROOT/assets/icon.svg" "$WORK/icon-1024.png"
render_svg "$ROOT/assets/icon-maskable.svg" "$WORK/icon-maskable-1024.png"

echo "→ Готовлю PNG для браузера"
mkdir -p "$BUILD"
cp "$WORK/icon-1024.png" "$BUILD/icon-1024.png"
cp "$WORK/icon-maskable-1024.png" "$BUILD/icon-maskable-1024.png"
sips -z 512 512 "$WORK/icon-1024.png" --out "$ROOT/assets/icon-512.png" >/dev/null
sips -z 192 192 "$WORK/icon-1024.png" --out "$ROOT/assets/icon-192.png" >/dev/null
sips -z 180 180 "$WORK/icon-1024.png" --out "$ROOT/assets/icon-180.png" >/dev/null
sips -z 32 32 "$WORK/icon-1024.png" --out "$ROOT/assets/favicon.png" >/dev/null
sips -z 512 512 "$WORK/icon-maskable-1024.png" --out "$ROOT/assets/icon-maskable-512.png" >/dev/null

echo "→ Собираю AppIcon.icns"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  sips -z "$size" "$size" "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/AppIcon.icns"

echo "Готово:"
echo "  assets/icon-512.png  assets/icon-192.png  assets/icon-180.png  assets/favicon.png"
echo "  assets/icon-maskable-512.png"
echo "  build/AppIcon.icns"
