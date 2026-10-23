#!/bin/bash
# Started by launchd (au.racelens.server). Loads the settings written by install.sh, reads the password from the
# Keychain (and refuses to start without one), and runs RaceLens while keeping the Mac awake (caffeinate -s: no
# system sleep while on mains power).
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
# `security … -w` prints a password holding any non-ASCII character as hex: turn that back into the password. Only
# an all-hex, even-length answer that decodes to valid UTF-8 with a byte >= 0x80 is decoded, so a real all-hex ASCII
# password (such as "deadbeef") is left alone.
from_keychain_hex() {
  perl -MEncode -e 'my $s = join "", <STDIN>; $s =~ s/\n\z//;
    if ($s =~ /\A(?:[0-9a-fA-F]{2})+\z/) { my $b = pack "H*", $s;
      if ($b =~ /[\x80-\xff]/ && eval { Encode::decode("UTF-8", my $c = $b, Encode::FB_CROAK); 1 }) { $s = $b } }
    print $s'
}
if KC="$(security find-generic-password -s racelens -a racelens -w 2>/dev/null)"; then
  RACELENS_PASSWORD="$(printf '%s' "$KC" | from_keychain_hex)"
else
  RACELENS_PASSWORD="$(cat "$SUPPORT/password" 2>/dev/null || true)"
fi
unset KC
if [ -z "$RACELENS_PASSWORD" ]; then
  # Never start without a password (anyone on the network could open RaceLens). launchd tries again in 10 seconds,
  # so a Keychain that is still locked just after start-up is picked up as soon as it opens.
  echo "$(date '+%H:%M:%S') [error] No RaceLens password found in the Keychain (still locked?) – not starting without one; trying again in 10 seconds. To set one: bash $APP_DIR/scripts/mac/install.sh --new-password" >&2
  exit 1
fi
export RACELENS_PASSWORD
cd "$APP_DIR"
exec /usr/bin/caffeinate -s "$RACELENS_NODE" dist/server/index.js
