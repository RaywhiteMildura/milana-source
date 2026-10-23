#!/bin/bash
# Stop and remove the RaceLens background service.
#   --purge   also delete your saved research, settings and the stored password (asks first unless unattended)
set -uo pipefail
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LABEL="au.racelens.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"
TS=""
if command -v tailscale >/dev/null 2>&1; then TS="$(command -v tailscale)"; elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi
if [ -n "$TS" ] && grep -q '^RACELENS_PUBLIC_URL=' "$SUPPORT/config.env" 2>/dev/null; then
  perl -e 'alarm 15; exec @ARGV' "$TS" serve --https=443 off >/dev/null 2>&1 || true
fi
echo "RaceLens service removed."
if [ "${1:-}" = "--purge" ]; then
  if [ -z "${RACELENS_INSTALL_UNATTENDED:-}" ]; then
    read -r -p "Also delete ALL saved research, settings and the RaceLens password? [y/N] " yn </dev/tty || yn=n
    [ "$yn" = "y" ] || [ "$yn" = "Y" ] || { echo "Kept your data in $SUPPORT"; exit 0; }
  fi
  rm -rf "$SUPPORT"
  security delete-generic-password -s racelens -a racelens >/dev/null 2>&1 || true
  echo "Deleted your RaceLens data and password."
else
  echo "Your research and settings are kept in $SUPPORT (run with --purge to delete them)."
fi
