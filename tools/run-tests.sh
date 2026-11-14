#!/usr/bin/env bash
#
# Прогоняет tools/test.html в headless Chrome и падает, если хоть одна проверка не прошла.
# Зависимостей нет: нужен только Chrome и python3 для статического сервера.
#
#   ./tools/run-tests.sh
#   CHROME=/path/to/chrome ./tools/run-tests.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
BUDGET_MS="${BUDGET_MS:-60000}"

find_chrome() {
  if [[ -n "${CHROME:-}" ]]; then
    printf '%s' "$CHROME"; return
  fi
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome || true)" \
    "$(command -v google-chrome-stable || true)" \
    "$(command -v chromium || true)" \
    "$(command -v chromium-browser || true)" \
    "/usr/bin/google-chrome" \
    "/opt/google/chrome/chrome"
  do
    [[ -n "$candidate" && -x "$candidate" ]] && { printf '%s' "$candidate"; return; }
  done
  return 1
}

CHROME_BIN="$(find_chrome)" || {
  echo "Не найден Chrome. Укажите путь: CHROME=/path/to/chrome $0" >&2
  exit 2
}

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# ждём, пока сервер поднимется
for _ in $(seq 1 50); do
  if python3 -c "
import socket, sys
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(('127.0.0.1', $PORT))
except OSError:
    sys.exit(1)
" 2>/dev/null; then break; fi
  sleep 0.1
done

HTML="$("$CHROME_BIN" --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget="$BUDGET_MS" --dump-dom \
  "http://localhost:$PORT/tools/test.html" 2>/dev/null)"

RESULT="$(printf '%s' "$HTML" | grep -oE 'ИТОГ: [^<]*' | head -1 || true)"
if [[ -z "$RESULT" ]]; then
  echo "Проверки не отработали: страница не добавила итог." >&2
  echo "Откройте вручную: http://localhost:$PORT/tools/test.html" >&2
  exit 1
fi

COUNT="$(printf '%s' "$HTML" | grep -c 'class="ok"' || true)"
echo "$RESULT ($COUNT ok)"

case "$RESULT" in
  *"ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ"*) exit 0 ;;
  *) echo "$HTML" | grep -oE 'class="fail">[^<]*' | sed 's/class="fail">/  ПРОВАЛ: /' >&2
     exit 1 ;;
esac
