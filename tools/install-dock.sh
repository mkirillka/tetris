#!/bin/bash
#
# Собирает ~/Applications/Тетрис.app и кладёт его в Dock.
#
# Приложение — тонкая обёртка: открывает index.html отдельным окном Chrome
# (--app, без адресной строки и вкладок). Если Chrome не установлен,
# откроется браузер по умолчанию.
#
#   ./tools/install-dock.sh              собрать и добавить в Dock
#   ./tools/install-dock.sh --no-dock    только собрать приложение
#
# Права администратора не нужны: всё в домашней папке пользователя.
# Удалить: перетащить «Тетрис» из Dock в корзину и удалить ~/Applications/Тетрис.app
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Тетрис.app"
HTML="$ROOT/index.html"
BUNDLE_ID="com.github.mkirillka.tetris"
ADD_TO_DOCK=1

for arg in "$@"; do
  case "$arg" in
    --no-dock) ADD_TO_DOCK=0 ;;
    *) echo "Неизвестный параметр: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$HTML" ]; then
  echo "Не найден index.html рядом со скриптом: $HTML" >&2
  exit 1
fi

if [ ! -f "$ROOT/build/AppIcon.icns" ]; then
  echo "→ Иконки не собраны, запускаю tools/build-icons.sh"
  "$ROOT/tools/build-icons.sh"
fi

echo "→ Собираю $APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/build/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# URL файла: пробелы и кириллица должны быть закодированы
FILE_URL="$(python3 - "$HTML" <<'PY'
import pathlib, sys
print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Тетрис</string>
  <key>CFBundleDisplayName</key><string>Тетрис</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Tetris</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMultipleInstancesProhibited</key><true/>
</dict>
</plist>
PLIST

LAUNCHER="$APP/Contents/MacOS/Tetris"
{
  echo '#!/bin/bash'
  echo '# Сгенерировано tools/install-dock.sh'
  echo "GAME_PATH='$HTML'"
  echo "GAME_URL='$FILE_URL'"
  cat <<'LAUNCH'
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -f "$GAME_PATH" ]; then
  osascript -e 'display alert "Тетрис не найден" message "Файл игры переехал или удалён. Запустите tools/install-dock.sh заново из папки игры."'
  exit 1
fi

if [ -x "$CHROME" ]; then
  exec "$CHROME" --app="$GAME_URL" --window-size=1040,820
fi
exec open "$GAME_URL"
LAUNCH
} > "$LAUNCHER"
chmod +x "$LAUNCHER"

plutil -lint "$APP/Contents/Info.plist" >/dev/null
bash -n "$LAUNCHER"

# сообщаем Finder и Dock о новом приложении, чтобы иконка не была «пустой»
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true
touch "$APP"

if [ "$ADD_TO_DOCK" -eq 1 ]; then
  APP_URL="$(python3 - "$APP" <<'PY'
import pathlib, sys
print(pathlib.Path(sys.argv[1]).resolve().as_uri() + '/')
PY
)"
  if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -qF "$APP_URL"; then
    echo "→ В Dock уже есть, пропускаю"
  else
    echo "→ Добавляю в Dock"
    defaults write com.apple.dock persistent-apps -array-add "<dict>
      <key>tile-data</key>
      <dict>
        <key>file-data</key>
        <dict>
          <key>_CFURLString</key><string>$APP_URL</string>
          <key>_CFURLStringType</key><integer>15</integer>
        </dict>
        <key>file-label</key><string>Тетрис</string>
        <key>file-type</key><integer>41</integer>
        <key>dock-extra</key><integer>0</integer>
      </dict>
      <key>tile-type</key><string>file-tile</string>
    </dict>"
    killall Dock
    sleep 1
    if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -qF "$APP_URL"; then
      echo "  Dock перезапущен, значок на месте"
    else
      echo "  Не удалось добавить автоматически — перетащи $APP в Dock вручную" >&2
    fi
  fi
fi

echo
echo "Готово: $APP"
echo "Если иконка в Dock не обновилась сразу — перетащи приложение из ~/Applications в Dock вручную."
