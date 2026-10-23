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
#   * when installed by the one-line installer (~/RaceLens/app), installs a second, tiny login service
#     (au.racelens.updater) that installs updates when you tap Settings → RaceLens version → Update RaceLens on
#     your phone (scripts/mac/self-update.sh);
#   * optionally (asks for your Mac password) sets the Mac to never sleep and to restart after a power cut;
#   * checks RaceLens answers, then prints the address and a QR code for your phone.
#
# Unattended use (tests): RACELENS_INSTALL_UNATTENDED=1 RACELENS_PASSWORD=... [RACELENS_SKIP_TAILSCALE=1] [RACELENS_SKIP_POWER=1]
# Updates from the phone run it with RACELENS_SELF_UPDATE=1: it then never asks anything (no password, no sudo) and
# keeps the password, the phone address (Tailscale or Wi-Fi) and every setting in config.env exactly as they were.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LOGS="$HOME/Library/Logs/RaceLens"
LABEL="au.racelens.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UPD_LABEL="au.racelens.updater"
UPD_PLIST="$HOME/Library/LaunchAgents/$UPD_LABEL.plist"
CONFIG="$SUPPORT/config.env"
SELF_UPDATE="${RACELENS_SELF_UPDATE:-}"
UNATTENDED="${RACELENS_INSTALL_UNATTENDED:-}"
[ -z "$SELF_UPDATE" ] || UNATTENDED=1
NEW_PASSWORD=""
for a in "$@"; do [ "$a" = "--new-password" ] && NEW_PASSWORD=1; done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mRaceLens install stopped: %s\033[0m\n' "$*" >&2; exit 1; }
# Run a command with a time limit (macOS has no `timeout`; perl is always there). The command runs as a child that is
# stopped with TERM, then KILL: Go programs such as the tailscale CLI ignore the SIGALRM a plain `alarm; exec` relies on.
with_timeout() {
  perl -e 'my $t = shift; my $p = fork; die "fork: $!\n" unless defined $p;
    if (!$p) { exec @ARGV or exit 127 }
    $SIG{ALRM} = sub { kill "TERM", $p; sleep 1; kill "KILL", $p; exit 124 };
    alarm $t; waitpid($p, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$@"
}
# Plain printable ASCII only: `security find-generic-password -w` hands back any other password as hex.
plain_ascii() { ! printf '%s' "$1" | LC_ALL=C grep -q '[^ -~]'; }
# For values put into a .plist (XML).
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS (see docs/DEPLOY.md for other options)."
mkdir -p "$SUPPORT/data" "$LOGS" "$HOME/Library/LaunchAgents"
chmod 700 "$SUPPORT"

# The settings of the last install, and one value from them (empty when there is none).
PREV_CONFIG="$(cat "$CONFIG" 2>/dev/null || true)"
prev() { printf '%s\n' "$PREV_CONFIG" | grep -E "^$1=" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
if [ -n "$SELF_UPDATE" ]; then
  # Phone update: every setting stays as it was (the updater's environment does not carry them).
  : "${RACELENS_PORT:=$(prev RACELENS_PORT)}"
  : "${RACELENS_MODE:=$(prev RACELENS_MODE)}"
  : "${RACELENS_FAKE_NOW:=$(prev RACELENS_FAKE_NOW)}"
  : "${RACELENS_CONTACT_EMAIL:=$(prev RACELENS_CONTACT_EMAIL)}"
fi
PORT="${RACELENS_PORT:-4850}"

# Installed by the one-line installer (~/RaceLens/app next to app-previous and node)? Only then can the phone
# update it: an update downloads a new ~/RaceLens/app and can go back to app-previous.
RL_HOME="${RACELENS_HOME:-$(dirname "$APP_DIR")}"
UPDATABLE=""
if [ -d "$RL_HOME" ] && [ "$(cd "$RL_HOME" && pwd -P)/app" = "$(cd "$APP_DIR" && pwd -P)" ]; then
  UPDATABLE=1
  RL_HOME="$(dirname "$APP_DIR")"
fi

# ---------------------------------------------------------------- Node and the build
NODE="${RACELENS_NODE:-}"
# Otherwise the same Node as last time, then the private copy the one-line installer downloads, then any Node 22.
[ -n "$NODE" ] || { NODE="$(prev RACELENS_NODE)"; [ -x "$NODE" ] || NODE=""; }
[ -n "$NODE" ] || { [ -x "$RL_HOME/node/bin/node" ] && NODE="$RL_HOME/node/bin/node"; } || true
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
if [ -n "$SELF_UPDATE" ]; then
  : # Phone update: the password stays exactly as it is – nothing is read, asked or changed.
elif [ -n "$NEW_PASSWORD" ] || ! have_password; then
  if [ -n "$UNATTENDED" ]; then
    [ -n "${RACELENS_PASSWORD:-}" ] || die "set RACELENS_PASSWORD for an unattended install."
    plain_ascii "$RACELENS_PASSWORD" || die "RACELENS_PASSWORD must use plain letters, digits, spaces and ordinary punctuation only."
    store_password "$RACELENS_PASSWORD"
  else
    say "Choose a password for RaceLens"
    echo "You type it once on your phone; it then stays signed in. At least 8 characters (a short phrase is easiest)."
    while :; do
      read -r -s -p "Password: " P1 </dev/tty; echo
      read -r -s -p "Same again: " P2 </dev/tty; echo
      if [ "${#P1}" -lt 8 ]; then warn "Please use at least 8 characters."; continue; fi
      if ! plain_ascii "$P1"; then warn "Please use only plain letters, digits, spaces and ordinary punctuation (no accents, emoji or symbols like é, £ or €)."; continue; fi
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
MODE="lan"; TS_NAME=""
if [ -n "$SELF_UPDATE" ] && [ -n "$PREV_CONFIG" ]; then
  # Phone update: the phone keeps exactly the address it has (Tailscale remembers its https publishing by itself),
  # so an update can never switch between Tailscale and Wi-Fi or lose the allowed address.
  PREV_URL="$(prev RACELENS_PUBLIC_URL)"
  if [ -n "$PREV_URL" ]; then MODE="tailscale"; TS_NAME="${PREV_URL#https://}"; TS_NAME="${TS_NAME%/}"; fi
elif [ -z "${RACELENS_SKIP_TAILSCALE:-}" ]; then
  if command -v tailscale >/dev/null 2>&1; then TS="$(command -v tailscale)";
  elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi
fi
# What Tailscale on this Mac says, as "<name> <https>": name is empty unless it is signed in and connected; https is
# on / off (HTTPS Certificates switched off for the tailnet: `tailscale serve` would then wait for ever) / unknown.
ts_check() {
  with_timeout 10 "$TS" status --json 2>/dev/null | "$NODE" -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s);
        const name = j.BackendState === "Running" && j.Self && j.Self.DNSName ? j.Self.DNSName.replace(/\.$/, "") : "";
        const https = !("CertDomains" in j) ? "unknown" : Array.isArray(j.CertDomains) && j.CertDomains.length ? "on" : "off";
        process.stdout.write(name + " " + https);
      } catch { process.stdout.write(" unknown"); }
    });' || true
}
# Does Tailscale really pass https://<this-mac>:443 on to RaceLens on this port?
serve_ok() {
  with_timeout 10 "$TS" serve status --json 2>/dev/null | "$NODE" -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const target = new RegExp("^(https?://)?(127\\.0\\.0\\.1|localhost):" + process.argv[1] + "/?$");
        const web = JSON.parse(s).Web || {};
        const ok = Object.keys(web).some((hp) => /:443$/.test(hp) &&
          Object.values((web[hp] && web[hp].Handlers) || {}).some((h) => h && typeof h.Proxy === "string" && target.test(h.Proxy)));
        process.exit(ok ? 0 : 1);
      } catch { process.exit(1); }
    });' "$PORT"
}
if [ -n "$TS" ]; then
  TS_INFO="$(ts_check)"; TS_NAME="${TS_INFO% *}"; TS_HTTPS="${TS_INFO##* }"
  if [ -n "$TS_NAME" ] && [ "$TS_HTTPS" = off ] && [ -z "$UNATTENDED" ]; then
    say "One more switch in Tailscale: HTTPS"
    echo "Tailscale on this Mac is signed in, but HTTPS Certificates are off for your account, so your phone cannot get"
    echo "a secure RaceLens address yet. On your phone open login.tailscale.com → DNS → turn on HTTPS Certificates"
    echo "(and MagicDNS), then press Return here."
    read -r _ </dev/tty || true
    TS_INFO="$(ts_check)"; TS_NAME="${TS_INFO% *}"; TS_HTTPS="${TS_INFO##* }"
  fi
  if [ -z "$TS_NAME" ]; then
    warn "Tailscale is installed but not signed in – sign in, then run this installer again. Using Wi-Fi only for now."
  elif [ "$TS_HTTPS" = off ]; then
    warn "HTTPS Certificates are still off in Tailscale. On your phone open login.tailscale.com → DNS, turn on MagicDNS and"
    warn "HTTPS Certificates, then run this installer again. Using Wi-Fi only for now."
    TS_NAME=""
  else
    say "Publishing RaceLens to your Tailscale devices at https://$TS_NAME …"
    SERVE_OUT="$(mktemp "${TMPDIR:-/tmp}/racelens-serve.XXXXXX")"
    SERVE_RC=0
    with_timeout 25 "$TS" serve --bg --https=443 "http://127.0.0.1:$PORT" >"$SERVE_OUT" 2>&1 || SERVE_RC=$?
    # Older Tailscale versions only know the short form; after a time-out (124) it would just wait again.
    if [ "$SERVE_RC" -ne 0 ] && [ "$SERVE_RC" -ne 124 ]; then
      with_timeout 25 "$TS" serve --bg "$PORT" >>"$SERVE_OUT" 2>&1 || true
    fi
    if serve_ok; then
      MODE="tailscale"
    else
      # Tailscale's own words (they may hold the link that switches https on for this Mac).
      if [ -s "$SERVE_OUT" ]; then echo "Tailscale says:"; sed 's/^/    /' "$SERVE_OUT"; fi
      warn "Tailscale could not publish an https address yet. In the Tailscale admin page (login.tailscale.com → DNS),"
      warn "turn on MagicDNS and HTTPS Certificates, then run this installer again. Using Wi-Fi only for now."
      TS_NAME=""
    fi
    rm -f "$SERVE_OUT"
  fi
fi

# ---------------------------------------------------------------- updates from the phone
# A second, tiny login service: launchd starts scripts/mac/self-update.sh as soon as the RaceLens server writes the
# request file (POST /api/update), and every two minutes as a safety net (it then finds nothing to do and stops at
# once). The update runs outside the server's own service, so restarting the server cannot cut it off halfway.
DOMAIN="gui/$(id -u)"
UPDATES_ON=""
if [ -n "$UPDATABLE" ]; then
  version_field() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$APP_DIR/VERSION.json" 2>/dev/null | head -n 1 || true; }
  UPD_REPO="${RACELENS_REPO:-$(version_field repo)}"
  UPD_BRANCH="${RACELENS_BRANCH:-$(version_field branch)}"
  UPD_ENV=""
  [ -z "$UPD_REPO" ] || UPD_ENV="$UPD_ENV
    <key>RACELENS_REPO</key><string>$(xml "$UPD_REPO")</string>"
  [ -z "$UPD_BRANCH" ] || UPD_ENV="$UPD_ENV
    <key>RACELENS_BRANCH</key><string>$(xml "$UPD_BRANCH")</string>"
  cat > "$UPD_PLIST.new" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$UPD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$APP_DIR")/scripts/mac/self-update.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RACELENS_SUPPORT_DIR</key><string>$(xml "$SUPPORT")</string>
    <key>RACELENS_HOME</key><string>$(xml "$RL_HOME")</string>$UPD_ENV
  </dict>
  <key>WatchPaths</key>
  <array>
    <string>$(xml "$SUPPORT")/update-request</string>
  </array>
  <key>StartInterval</key><integer>120</integer>
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>$(xml "$LOGS")/update.log</string>
  <key>StandardErrorPath</key><string>$(xml "$LOGS")/update.log</string>
</dict>
</plist>
PLIST
  plutil -lint "$UPD_PLIST.new" >/dev/null || die "the updater service file is not valid."
  if cmp -s "$UPD_PLIST.new" "$UPD_PLIST" && launchctl print "$DOMAIN/$UPD_LABEL" >/dev/null 2>&1; then
    rm -f "$UPD_PLIST.new"; UPDATES_ON=1
  elif [ -n "$SELF_UPDATE" ] && launchctl print "$DOMAIN/$UPD_LABEL" >/dev/null 2>&1; then
    # Running inside the updater itself: reloading it now would stop this very update. launchd reads the new file
    # at the next login (or the next time this installer runs on the Mac); the script it runs is already the new one.
    mv -f "$UPD_PLIST.new" "$UPD_PLIST"; UPDATES_ON=1
  else
    launchctl bootout "$DOMAIN/$UPD_LABEL" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do launchctl print "$DOMAIN/$UPD_LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
    mv -f "$UPD_PLIST.new" "$UPD_PLIST"
    if launchctl bootstrap "$DOMAIN" "$UPD_PLIST"; then
      UPDATES_ON=1
    else
      warn "macOS did not start the updater service, so updating from the phone is off for now (RaceLens itself is fine)."
      warn "Run the one-line install command again later to retry."
    fi
  fi
elif [ -f "$UPD_PLIST" ]; then
  # Not the one-line installer's folder (e.g. a git checkout): an updater left from an earlier install would
  # replace this copy with ~/RaceLens/app, so remove it. Update a checkout with git instead.
  launchctl bootout "$DOMAIN/$UPD_LABEL" >/dev/null 2>&1 || true
  rm -f "$UPD_PLIST"
fi

# ---------------------------------------------------------------- settings file (no secrets in it)
# Written next to the old one and then moved over it, so it is never half-written.
KNOWN_KEYS='RACELENS_NODE|RACELENS_PORT|RACELENS_DATA_DIR|RACELENS_QR|RACELENS_HOST|RACELENS_TRUST_PROXY|RACELENS_ALLOWED_HOSTS|RACELENS_PUBLIC_URL|RACELENS_MODE|RACELENS_FAKE_NOW|RACELENS_CONTACT_EMAIL|RACELENS_UPDATE_DIR'
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
  # Tells the server that updating from the phone works here (GET/POST /api/update) and where the request goes.
  [ -n "$UPDATES_ON" ] && echo "RACELENS_UPDATE_DIR=\"$SUPPORT\""
  # Phone update: keep any other line that was there.
  if [ -n "$SELF_UPDATE" ]; then
    printf '%s\n' "$PREV_CONFIG" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | grep -Ev "^($KNOWN_KEYS)=" || true
  fi
  true
} > "$CONFIG.new"
chmod 600 "$CONFIG.new"
mv -f "$CONFIG.new" "$CONFIG"

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
fi

# ---------------------------------------------------------------- coming back after a power cut
# RaceLens (and Tailscale) only start once a user is logged in. Neither check needs the Mac's password.
if [ -z "$SELF_UPDATE" ]; then
  ME="$(id -un)"
  AUTO_LOGIN="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)"
  if [ "$(fdesetup isactive 2>/dev/null || true)" = "true" ]; then
    say "Heads-up: after a power cut this Mac needs someone at it"
    echo "FileVault (disk encryption) is on, and with FileVault macOS cannot log in by itself. After a power cut or restart"
    echo "the Mac waits at its password screen, and RaceLens and Tailscale only start once someone types the Mac's"
    echo "password at the Mac itself. Your choice:"
    echo "  * keep FileVault on (best if the Mac could be stolen) and type the password at the Mac after a power cut; or"
    echo "  * turn it off so RaceLens comes back by itself: System Settings → Privacy & Security → FileVault → Turn Off,"
    echo "    then System Settings → Users & Groups → Automatically log in as: $ME."
  elif [ "$AUTO_LOGIN" = "$ME" ]; then
    echo "This Mac logs in by itself after a restart or power cut, so RaceLens comes back on its own."
  else
    say "One more setting so RaceLens comes back after a power cut"
    echo "Automatic login is off, so after a restart RaceLens waits until someone logs in at the Mac. Turn it on:"
    echo "System Settings → Users & Groups → Automatically log in as: $ME."
  fi
fi

# ---------------------------------------------------------------- tell the owner where to go
if [ "$MODE" = "tailscale" ]; then
  URL="https://$TS_NAME"
  if [ -z "$SELF_UPDATE" ] && ! curl -fsS -m 10 "$URL/api/health" >/dev/null 2>&1; then
    warn "Note: $URL did not answer from this Mac yet. The first https request can take a minute while Tailscale gets a certificate."
  fi
  WHERE="anywhere – on your phone, switch Tailscale on (same account as this Mac)"
else
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  URL="http://${IP:-this-mac}:$PORT"
  WHERE="on the same Wi-Fi as this Mac only (install Tailscale to use it at the track – see docs/MAC-MINI.md)"
fi

say "RaceLens is running."
if [ "$MODE" = "tailscale" ] && [ "$(prev RACELENS_HOST)" = "0.0.0.0" ]; then
  warn "Your phone address has changed to $URL – delete the old RaceLens icon from your home screen and add it again from the new address."
fi
echo "On your phone, open:  $URL"
echo "Works: $WHERE"
if [ -z "$SELF_UPDATE" ]; then
  (cd "$APP_DIR" && "$NODE" -e "require('qrcode').toString(process.argv[1],{type:'terminal',small:true}).then(q=>console.log(q))" "$URL") 2>/dev/null || true
fi
echo "Then sign in with your RaceLens password and add it to your home screen:"
echo "  iPhone: Safari → Share → Add to Home Screen.   Android: Chrome → ⋮ → Add to Home screen / Install app."
echo
echo "Status:  bash $APP_DIR/scripts/mac/status.sh      Log: $LOGS/server.log"
if [ -n "$UPDATES_ON" ]; then
  echo "Update:  on your phone, Settings → RaceLens version → Update RaceLens (or run the one-line install command again)."
else
  echo "Update:  run the same one-line install command again."
fi
