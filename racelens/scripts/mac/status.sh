#!/bin/bash
# Is RaceLens running on this Mac? Prints the service state, the health answer, the phone address and the latest log lines.
set -uo pipefail
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LABEL="au.racelens.server"
LOG="$HOME/Library/Logs/RaceLens/server.log"
PORT="$(grep -E '^RACELENS_PORT=' "$SUPPORT/config.env" 2>/dev/null | cut -d= -f2 | tr -d '"')"
PORT="${PORT:-4850}"
echo "== Service"
if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^\s*(state|pid|last exit code|runs) =' ; then :; else echo "not installed (run the installer)"; fi
echo "== Health"
if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health"; then echo; else echo "RaceLens is not answering on port $PORT"; fi
echo "== Phone address"
URL="$(grep -E '^RACELENS_PUBLIC_URL=' "$SUPPORT/config.env" 2>/dev/null | cut -d= -f2 | tr -d '"')"
if [ -n "$URL" ]; then echo "$URL (Tailscale)"; else echo "http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo this-mac):$PORT (same Wi-Fi only)"; fi
echo "== Last log lines ($LOG)"
tail -n 15 "$LOG" 2>/dev/null || echo "no log yet"
