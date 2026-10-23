#!/bin/bash
# Started by launchd (au.racelens.server). Loads the settings written by install.sh, reads the password from the
# Keychain, and runs RaceLens while keeping the Mac awake (caffeinate -s: no system sleep while on mains power).
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LOG="$HOME/Library/Logs/RaceLens/server.log"

# Keep the log from growing without limit: roll it over at 10 MB (checked each time the service starts).
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 10485760 ]; then mv -f "$LOG" "$LOG.1"; fi

set -a
# shellcheck disable=SC1091
. "$SUPPORT/config.env"
set +a
RACELENS_PASSWORD="$(security find-generic-password -s racelens -a racelens -w 2>/dev/null || cat "$SUPPORT/password" 2>/dev/null || true)"
if [ -z "$RACELENS_PASSWORD" ]; then
  echo "$(date '+%H:%M:%S') [warn] No RaceLens password found in the Keychain – run scripts/mac/install.sh --new-password" >&2
fi
export RACELENS_PASSWORD
cd "$APP_DIR"
exec /usr/bin/caffeinate -s "$RACELENS_NODE" dist/server/index.js
