#!/bin/bash
# Set RaceLens up as a background service on this Mac, for use from your phone.
# Normally run for you by bootstrap.sh; you can also run it from a checkout:  bash scripts/mac/install.sh
#
#   --new-password   choose a new RaceLens password (signs every phone out)
#
# What it does (safe to run again – it updates what is there):
#   * stores your RaceLens password in the macOS Keychain (never in a file or on screen);
#   * if Tailscale is installed and signed in, publishes RaceLens to your own devices at
#     https://<this-mac>.<your-tailnet>.ts.net (works anywhere, and lets the phone install it full-screen);
#     otherwise it serves your home/office Wi-Fi only;
#   * installs a login service (~/Library/LaunchAgents/au.racelens.server.plist) that starts RaceLens when the Mac
#     starts, restarts it if it ever stops, and keeps the Mac awake while it runs;
#   * optionally (asks for your Mac password) sets the Mac to never sleep and to restart after a power cut;
#   * checks RaceLens answers, then prints the address and a QR code for your phone.
#
# Unattended use (tests): RACELENS_INSTALL_UNATTENDED=1 RACELENS_PASSWORD=... [RACELENS_SKIP_TAILSCALE=1] [RACELENS_SKIP_POWER=1]
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LOGS="$HOME/Library/Logs/RaceLens"
LABEL="au.racelens.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${RACELENS_PORT:-4850}"
UNATTENDED="${RACELENS_INSTALL_UNATTENDED:-}"
NEW_PASSWORD=""
for a in "$@"; do [ "$a" = "--new-password" ] && NEW_PASSWORD=1; done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mRaceLens install stopped: %s\033[0m\n' "$*" >&2; exit 1; }
# Run a command with a time limit (macOS has no `timeout`; perl is always there).
with_timeout() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS (see docs/DEPLOY.md for other options)."
mkdir -p "$SUPPORT/data" "$LOGS" "$HOME/Library/LaunchAgents"
chmod 700 "$SUPPORT"

# ---------------------------------------------------------------- Node and the build
NODE="${RACELENS_NODE:-}"
[ -n "$NODE" ] || { [ -x "$HOME/RaceLens/node/bin/node" ] && NODE="$HOME/RaceLens/node/bin/node"; } || true
[ -n "$NODE" ] || NODE="$(command -v node || true)"
[ -n "$NODE" ] && [ -x "$NODE" ] || die "Node.js 22 was not found. Run the one-line installer from docs/MAC-MINI.md, or install Node 22 from nodejs.org."
"$NODE" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)" || die "Node.js $("$NODE" -v) is too old – RaceLens needs 22.12 or newer."
NODE_BIN_DIR="$(dirname "$NODE")"; export PATH="$NODE_BIN_DIR:$PATH"
if [ ! -f "$APP_DIR/dist/server/index.js" ] || [ ! -f "$APP_DIR/dist/web/index.html" ]; then
  say "Building RaceLens…"
  (cd "$APP_DIR" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent) || die "the build failed (see above)."
fi

# Bring over research from an older install that kept it inside the app folder.
if [ -d "$APP_DIR/data/packs" ] && [ -z "$(ls -A "$SUPPORT/data" 2>/dev/null)" ]; then
  cp -R "$APP_DIR/data/." "$SUPPORT/data/" && echo "Moved your saved research to $SUPPORT/data"
fi

# ---------------------------------------------------------------- password (Keychain)
KC_SERVICE="racelens"; KC_ACCOUNT="racelens"
have_password() { security find-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w >/dev/null 2>&1 || [ -s "$SUPPORT/password" ]; }
store_password() { # $1 = password
  if security add-generic-password -U -s "$KC_SERVICE" -a "$KC_ACCOUNT" -l "RaceLens" -w "$1" >/dev/null 2>&1; then
    rm -f "$SUPPORT/password"
  else
    # No usable Keychain (e.g. a test machine): a file only this user can read.
    ( umask 077; printf '%s' "$1" > "$SUPPORT/password" )
  fi
}
if [ -n "$NEW_PASSWORD" ] || ! have_password; then
  if [ -n "$UNATTENDED" ]; then
    [ -n "${RACELENS_PASSWORD:-}" ] || die "set RACELENS_PASSWORD for an unattended install."
    store_password "$RACELENS_PASSWORD"
  else
    say "Choose a password for RaceLens"
    echo "You type it once on your phone; it then stays signed in. At least 8 characters (a short phrase is easiest)."
    while :; do
      read -r -s -p "Password: " P1 </dev/tty; echo
      read -r -s -p "Same again: " P2 </dev/tty; echo
      if [ "${#P1}" -lt 8 ]; then warn "Please use at least 8 characters."; continue; fi
      if [ "$P1" != "$P2" ]; then warn "Those did not match – try again."; continue; fi
      break
    done
    store_password "$P1"
    unset P1 P2
    echo "Saved in this Mac's Keychain (item \"RaceLens\")."
  fi
fi

# ---------------------------------------------------------------- how the phone reaches it
TS=""
if [ -z "${RACELENS_SKIP_TAILSCALE:-}" ]; then
  if command -v tailscale >/dev/null 2>&1; then TS="$(command -v tailscale)";
  elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi
fi
MODE="lan"; TS_NAME=""
if [ -n "$TS" ]; then
  TS_NAME="$(with_timeout 10 "$TS" status --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.BackendState==="Running"&&j.Self&&j.Self.DNSName)process.stdout.write(j.Self.DNSName.replace(/\.$/,""))}catch{}})' || true)"
  if [ -n "$TS_NAME" ]; then
    say "Publishing RaceLens to your Tailscale devices at https://$TS_NAME …"
    if with_timeout 25 "$TS" serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null 2>&1 || with_timeout 25 "$TS" serve --bg "$PORT" >/dev/null 2>&1; then
      MODE="tailscale"
    else
      warn "Tailscale could not publish an https address yet. In the Tailscale admin page (login.tailscale.com → DNS),"
      warn "turn on MagicDNS and HTTPS Certificates, then run this installer again. Using Wi-Fi only for now."
    fi
  else
    warn "Tailscale is installed but not signed in – sign in, then run this installer again. Using Wi-Fi only for now."
  fi
fi

# ---------------------------------------------------------------- settings file (no secrets in it)
CONFIG="$SUPPORT/config.env"
{
  echo "# Written by scripts/mac/install.sh – run it again rather than editing by hand."
  echo "RACELENS_NODE=\"$NODE\""
  echo "RACELENS_PORT=\"$PORT\""
  echo "RACELENS_DATA_DIR=\"$SUPPORT/data\""
  echo "RACELENS_QR=0"
  if [ "$MODE" = "tailscale" ]; then
    # Only reachable through Tailscale's https proxy on this Mac (and this Mac itself) – nothing is opened on the Wi-Fi.
    echo "RACELENS_HOST=127.0.0.1"
    echo "RACELENS_TRUST_PROXY=1"
    echo "RACELENS_ALLOWED_HOSTS=\"$TS_NAME\""
    echo "RACELENS_PUBLIC_URL=\"https://$TS_NAME\""
  else
    echo "RACELENS_HOST=0.0.0.0"
  fi
  [ -n "${RACELENS_MODE:-}" ] && echo "RACELENS_MODE=\"$RACELENS_MODE\""
  [ -n "${RACELENS_FAKE_NOW:-}" ] && echo "RACELENS_FAKE_NOW=\"$RACELENS_FAKE_NOW\""
  [ -n "${RACELENS_CONTACT_EMAIL:-}" ] && echo "RACELENS_CONTACT_EMAIL=\"$RACELENS_CONTACT_EMAIL\""
  true
} > "$CONFIG"
chmod 600 "$CONFIG"

# ---------------------------------------------------------------- the background service
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/scripts/mac/run.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RACELENS_SUPPORT_DIR</key><string>$SUPPORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.log</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null || die "the service file is not valid."

say "Starting the RaceLens service…"
DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
# bootout is asynchronous: wait until the old copy has really gone before starting the new one.
for _ in $(seq 1 20); do launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "$DOMAIN" "$PLIST" || die "macOS refused to start the service (see: launchctl print $DOMAIN/$LABEL)."
launchctl enable "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

ok=""
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  tail -n 30 "$LOGS/server.log" 2>/dev/null || true
  die "RaceLens did not answer within a minute – the last lines of its log are above ($LOGS/server.log)."
fi

# ---------------------------------------------------------------- keep the Mac available
if [ -z "${RACELENS_SKIP_POWER:-}" ] && [ -z "$UNATTENDED" ]; then
  say "Keep this Mac available for your phone?"
  echo "This sets the Mac to never go to sleep and to start again by itself after a power cut."
  read -r -p "Change these settings now? It asks for your Mac's password. [Y/n] " yn </dev/tty || yn=n
  if [ "${yn:-Y}" != "n" ] && [ "${yn:-Y}" != "N" ]; then
    sudo pmset -a sleep 0 autorestart 1 && echo "Done: never sleeps, restarts after a power cut."
    if [ "$MODE" = "lan" ] && /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | grep -qi enabled; then
      sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$NODE" >/dev/null && sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$NODE" >/dev/null && echo "The Mac's firewall now lets your phone reach RaceLens."
    fi
  fi
  echo "Also check: System Settings → Users & Groups → Automatically log in as you (so RaceLens starts after a restart without anyone at the Mac)."
fi

# ---------------------------------------------------------------- tell the owner where to go
if [ "$MODE" = "tailscale" ]; then
  URL="https://$TS_NAME"
  if ! curl -fsS -m 10 "$URL/api/health" >/dev/null 2>&1; then
    warn "Note: $URL did not answer from this Mac yet. The first https request can take a minute while Tailscale gets a certificate."
  fi
  WHERE="anywhere – on your phone, switch Tailscale on (same account as this Mac)"
else
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  URL="http://${IP:-this-mac}:$PORT"
  WHERE="on the same Wi-Fi as this Mac only (install Tailscale to use it at the track – see docs/MAC-MINI.md)"
fi

say "RaceLens is running."
echo "On your phone, open:  $URL"
echo "Works: $WHERE"
(cd "$APP_DIR" && "$NODE" -e "require('qrcode').toString(process.argv[1],{type:'terminal',small:true}).then(q=>console.log(q))" "$URL") 2>/dev/null || true
echo "Then sign in with your RaceLens password and add it to your home screen:"
echo "  iPhone: Safari → Share → Add to Home Screen.   Android: Chrome → ⋮ → Add to Home screen / Install app."
echo
echo "Status:  bash $APP_DIR/scripts/mac/status.sh      Log: $LOGS/server.log"
echo "Update:  run the same one-line install command again."
