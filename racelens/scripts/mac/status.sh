#!/bin/bash
# Is RaceLens running on this Mac? Prints the service state, the installed version, the last update from the phone,
# the health answer, the phone address and the latest log lines.
set -uo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
LABEL="au.racelens.server"
UPD_LABEL="au.racelens.updater"
LOG="$HOME/Library/Logs/RaceLens/server.log"
UPDATE_LOG="$HOME/Library/Logs/RaceLens/update.log"
PORT="$(grep -E '^RACELENS_PORT=' "$SUPPORT/config.env" 2>/dev/null | cut -d= -f2 | tr -d '"')"
PORT="${PORT:-4850}"
# Run a command with a time limit, stopping it with TERM then KILL (the Go-based tailscale CLI ignores SIGALRM).
with_timeout() {
  perl -e 'my $t = shift; my $p = fork; die "fork: $!\n" unless defined $p;
    if (!$p) { exec @ARGV or exit 127 }
    $SIG{ALRM} = sub { kill "TERM", $p; sleep 1; kill "KILL", $p; exit 124 };
    alarm $t; waitpid($p, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$@"
}
# A "key": "value" from a small JSON file (empty when missing).
json_field() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" 2>/dev/null | head -n 1; }
echo "== Service"
if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^\s*(state|pid|last exit code|runs) =' ; then :; else echo "not installed (run the installer)"; fi
echo "== Version"
if [ -f "$APP_DIR/VERSION.json" ]; then
  COMMIT="$(json_field commit "$APP_DIR/VERSION.json")"
  echo "${COMMIT:-unknown commit} ($(json_field branch "$APP_DIR/VERSION.json")), installed $(json_field installedAt "$APP_DIR/VERSION.json")"
else
  echo "not recorded (installed before RaceLens recorded its version – the next update records it)"
fi
echo "== Updates from the phone (Settings → RaceLens version → Update RaceLens)"
if launchctl print "gui/$(id -u)/$UPD_LABEL" >/dev/null 2>&1; then echo "ready"; else echo "not set up – run the one-line install command once on this Mac"; fi
[ ! -e "$SUPPORT/update-request" ] || echo "an update has been requested and starts within a minute or two"
STATUS="$SUPPORT/update-status.json"
if [ -f "$STATUS" ]; then
  STATE="$(json_field state "$STATUS")"
  FINISHED="$(json_field finishedAt "$STATUS")"
  echo "last update: $STATE (started $(json_field startedAt "$STATUS")${FINISHED:+, finished $FINISHED})"
  echo "  $(json_field message "$STATUS")"
  echo "  details: $UPDATE_LOG"
else
  echo "last update: none from the phone yet"
fi
echo "== Health"
if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health"; then echo; else echo "RaceLens is not answering on port $PORT"; fi
URL="$(grep -E '^RACELENS_PUBLIC_URL=' "$SUPPORT/config.env" 2>/dev/null | cut -d= -f2 | tr -d '"')"
NODE="$(grep -E '^RACELENS_NODE=' "$SUPPORT/config.env" 2>/dev/null | cut -d= -f2- | tr -d '"')"
[ -n "$NODE" ] && [ -x "$NODE" ] || NODE="$(command -v node || true)"
echo "== Tailscale"
TS=""
if command -v tailscale >/dev/null 2>&1; then TS="$(command -v tailscale)"; elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi
if [ -z "$TS" ]; then
  if [ -n "$URL" ]; then echo "Tailscale is not installed on this Mac any more, so $URL cannot work – install it again from the Mac App Store."
  else echo "not installed (RaceLens works on the Mac's Wi-Fi only – see docs/MAC-MINI.md Step 1 to use it anywhere)"; fi
else
  TS_JSON="$(with_timeout 10 "$TS" status --json 2>/dev/null || true)"
  TS_STATE="$(printf '%s\n' "$TS_JSON" | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  case "$TS_STATE" in
    Running) echo "connected (BackendState: Running)" ;;
    NeedsLogin) echo "Tailscale on this Mac is not signed in (BackendState: NeedsLogin) – click the Tailscale icon in the menu bar and sign in with the same account as your phone." ;;
    Stopped) echo "Tailscale on this Mac is switched off (BackendState: Stopped) – click the Tailscale icon in the menu bar and turn it on." ;;
    NeedsMachineAuth) echo "This Mac is waiting for approval (BackendState: NeedsMachineAuth) – approve it at login.tailscale.com → Machines." ;;
    Starting) echo "Tailscale on this Mac is still starting (BackendState: Starting) – check again in a minute." ;;
    '') echo "Tailscale on this Mac did not answer – open the Tailscale app (menu bar icon) and make sure it is connected." ;;
    *) echo "Tailscale on this Mac is not connected (BackendState: $TS_STATE) – click the Tailscale icon in the menu bar and sign in." ;;
  esac
  if [ "$TS_STATE" = Running ] && [ -n "$NODE" ]; then
    HTTPS="$(printf '%s' "$TS_JSON" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(!("CertDomains" in j)?"":Array.isArray(j.CertDomains)&&j.CertDomains.length?"on":"off")}catch{}})' 2>/dev/null || true)"
    [ "$HTTPS" != off ] || echo "HTTPS Certificates are off for your Tailscale account – on your phone open login.tailscale.com → DNS and turn on MagicDNS and HTTPS Certificates, then run the installer again."
  fi
fi
echo "== Phone address"
if [ -n "$URL" ]; then
  echo "$URL (Tailscale)"
  if curl -fsS -m 10 -o /dev/null "$URL/api/health" 2>/dev/null; then
    echo "answers over https from this Mac"
  else
    echo "does NOT answer over https from this Mac – check the Tailscale section above; if Tailscale is connected, run the installer again (it re-publishes the address)."
  fi
else
  echo "http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo this-mac):$PORT (same Wi-Fi only)"
fi
echo "== Last log lines ($LOG)"
tail -n 15 "$LOG" 2>/dev/null || echo "no log yet"
