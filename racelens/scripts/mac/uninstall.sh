#!/bin/bash
# Stop and remove the RaceLens background service (and the updater that installs updates from the phone).
#   --purge   also delete your saved research, settings and the stored password (asks first unless unattended)
set -uo pipefail
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LABEL="au.racelens.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UPD_LABEL="au.racelens.updater"
UPD_PLIST="$HOME/Library/LaunchAgents/$UPD_LABEL.plist"
# Run a command with a time limit, stopping it with TERM then KILL (the Go-based tailscale CLI ignores SIGALRM).
with_timeout() {
  perl -e 'my $t = shift; my $p = fork; die "fork: $!\n" unless defined $p;
    if (!$p) { exec @ARGV or exit 127 }
    $SIG{ALRM} = sub { kill "TERM", $p; sleep 1; kill "KILL", $p; exit 124 };
    alarm $t; waitpid($p, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$@"
}
# The updater first, so it cannot start the server again halfway through.
launchctl bootout "gui/$(id -u)/$UPD_LABEL" >/dev/null 2>&1 || true
rm -f "$UPD_PLIST" "$SUPPORT/update-request"
rm -rf "$SUPPORT/update.lock"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"
TS=""
if command -v tailscale >/dev/null 2>&1; then TS="$(command -v tailscale)"; elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi
if [ -n "$TS" ] && grep -q '^RACELENS_PUBLIC_URL=' "$SUPPORT/config.env" 2>/dev/null; then
  with_timeout 15 "$TS" serve --https=443 off >/dev/null 2>&1 || true
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
