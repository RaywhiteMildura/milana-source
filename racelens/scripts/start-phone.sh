#!/usr/bin/env bash
# =============================================================================
#  RaceLens - start it so your phone can use it (macOS / Linux)
#
#  From Terminal:   bash scripts/start-phone.sh        (or ./scripts/start-phone.sh)
#  It:
#    1. moves into the RaceLens folder,
#    2. installs/builds the app the first time (needs internet once),
#    3. asks for a phone-login password (hidden while you type; Enter for none),
#    4. starts the server for your whole network and prints a QR code -
#       scan it with your phone's camera on the same Wi-Fi.
#  Keep the Terminal window open for the whole race day. Ctrl+C stops it.
#  Full guide: docs/DEPLOY.md
#
#  The password is asked for and hidden while you type - the most private way.
#  Without typing it each time:   bash scripts/start-phone.sh "my pass phrase"
#  or:                            RACELENS_PASSWORD="my pass phrase" bash scripts/start-phone.sh
#  Keep the quotes if it has spaces. Both forms are saved in your shell
#  history (~/.zsh_history or ~/.bash_history), so only use them on a computer
#  nobody else uses.
#
#  macOS tips
#   - Double-click to start: make a copy named start-phone.command next to this
#     file (cp scripts/start-phone.sh scripts/start-phone.command; chmod +x it);
#     Finder opens .command files in Terminal.
#   - Keep the Mac awake: this script wraps the server in `caffeinate`, which
#     stops idle sleep while RaceLens runs. Closing a MacBook lid still sleeps it
#     unless it is plugged in with an external display, so leave the lid open
#     (the screen itself may go dark - that is fine) or set System Settings ->
#     Battery/Energy -> "Prevent automatic sleeping when the display is off".
#   - Start at login: System Settings -> General -> Login Items -> "+" -> pick
#     your start-phone.command copy.
#
#  Linux tips
#   - Keep it awake: disable suspend in your power settings, or run it under
#     `systemd-inhibit --what=sleep bash scripts/start-phone.sh`.
#   - Start at login: add it to your desktop's "Startup Applications", or make a
#     small systemd --user service that runs `npm run start:phone` in this folder.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# A password with spaces arrives as several words unless it is in quotes: say so here,
# instead of starting with only the first word and refusing the real password on the phone.
if [ $# -gt 1 ]; then
  echo "The password arrived as several words. If it contains spaces, put it in quotes:"
  echo '    bash scripts/start-phone.sh "my pass phrase"'
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing RaceLens dependencies - first time only, this takes a minute..."
  npm install
fi

if [ ! -f dist/server/index.js ]; then
  echo "Building RaceLens - first time only..."
  npm run build
fi

# Listen on every network address, not just this computer, so the phone can reach it.
export RACELENS_HOST=0.0.0.0

if [ -n "${1:-}" ]; then
  export RACELENS_PASSWORD="$1"
fi
if [ -z "${RACELENS_PASSWORD:-}" ] && [ -t 0 ]; then
  echo
  echo "A password stops other people on the Wi-Fi from opening RaceLens."
  read -r -s -p "Password for the phone login (press Enter for none): " RACELENS_PASSWORD
  echo
  export RACELENS_PASSWORD
fi

echo
echo "Starting RaceLens... keep this window open during the race day. Press Ctrl+C to stop."
echo

# macOS: caffeinate -i prevents idle sleep, -s prevents system sleep while on
# mains power; both end automatically when the server exits.
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i -s node dist/server/index.js
fi
exec node dist/server/index.js
