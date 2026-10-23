#!/bin/bash
# Installs the latest RaceLens when you tap Settings → RaceLens version → Update RaceLens on your phone.
#
# Started by launchd (the au.racelens.updater login service that install.sh sets up) as soon as the RaceLens server
# writes the request file <support>/update-request (POST /api/update). The server never runs the update itself:
# restarting the server would stop it halfway. launchd also starts this every two minutes as a safety net; with no
# request it stops at once without touching anything. By hand, on the Mac or over SSH:
#   bash ~/RaceLens/app/scripts/mac/self-update.sh --now
#
#   1. takes a lock (one update at a time), tells the phone it is running (<support>/update-status.json), and
#      removes the request;
#   2. runs the one-line installer (bootstrap.sh) unattended: it downloads and builds the new version in
#      ~/RaceLens/app-new while the current one keeps serving, swaps it in (keeping ~/RaceLens/app-previous) and
#      runs install.sh with RACELENS_SELF_UPDATE=1, which never asks anything (no password, no sudo) and keeps the
#      password, the phone address and every setting as they were;
#   3. waits up to 90 seconds for http://127.0.0.1:<port>/api/health to answer;
#   4. if the new version did not install or does not answer, puts app-previous back and restarts it;
#   5. writes the result for the phone: update-status.json
#      {state:'running'|'done'|'failed', startedAt, finishedAt, ok, message, from, to} (from/to = commit ids).
# Everything is logged to ~/Library/Logs/RaceLens/update.log.
set -uo pipefail

SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
REQUEST="$SUPPORT/update-request"
STATUS="$SUPPORT/update-status.json"
LOCK="$SUPPORT/update.lock"
LOGS="$HOME/Library/Logs/RaceLens"
LOG="$LOGS/update.log"
HEALTH_WAIT="${RACELENS_UPDATE_HEALTH_WAIT:-90}"
# A download or build that hangs is stopped after 25 minutes (the server treats 'running' older than 30 as stale).
MAX_SECONDS="${RACELENS_UPDATE_MAX_SECONDS:-1500}"

BY_HAND=""
for a in "$@"; do [ "$a" = "--now" ] && BY_HAND=1; done
# Nothing asked for (the safety-net start): stop at once.
[ -e "$REQUEST" ] || [ -n "$BY_HAND" ] || exit 0

# Run from a copy: the update moves the folder this script lives in (and may put the old one back).
if [ -z "${RACELENS_UPDATE_COPY:-}" ]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COPY="$(mktemp -d "${TMPDIR:-/tmp}/racelens-update.XXXXXX")" || exit 1
  cp "$SELF_DIR/self-update.sh" "$SELF_DIR/bootstrap.sh" "$COPY/" || exit 1
  export RACELENS_UPDATE_COPY="$COPY"
  export RACELENS_HOME="${RACELENS_HOME:-$(cd "$SELF_DIR/../../.." && pwd)}"
  exec /bin/bash "$COPY/self-update.sh" "$@"
fi
COPY="$RACELENS_UPDATE_COPY"
HOME_DIR="$RACELENS_HOME"
APP="$HOME_DIR/app"

mkdir -p "$LOGS" "$SUPPORT"
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" | tr -d ' ')" -gt 5242880 ]; then mv -f "$LOG" "$LOG.1"; fi
if [ -t 1 ]; then
  echo "Updating RaceLens – this takes a few minutes. (Also logged to $LOG)"
  exec > >(tee -a "$LOG") 2>&1
else
  exec >>"$LOG" 2>&1
fi

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
iso_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
short() { printf '%s' "$1" | cut -c1-7; }
# A JSON string that needs no escapes: control characters dropped, " and \ swapped for ' and /.
json_str() { printf '"%s"' "$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\037' | LC_ALL=C tr '\042\134' '\047/')"; }
# A "key": "value" from a small JSON file such as VERSION.json (empty when missing).
version_field() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" 2>/dev/null | head -n 1; }
config_value() { grep -E "^$1=" "$SUPPORT/config.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
# The folder's inode: it changes when bootstrap.sh swaps app-new in (mv keeps a folder's inode). Empty when missing.
dir_id() { perl -e '@s = stat shift; print $s[1] if @s' "$1"; }

STARTED=""; FROM=""; TO=""
write_status() { # state, ok (true/false/empty), message
  local state="$1" ok="$2" msg="$3" body
  body="{\"state\":$(json_str "$state")"
  [ -z "$STARTED" ] || body="$body,\"startedAt\":$(json_str "$STARTED")"
  [ "$state" = running ] || body="$body,\"finishedAt\":$(json_str "$(iso_now)")"
  [ -z "$ok" ] || body="$body,\"ok\":$ok"
  body="$body,\"message\":$(json_str "$msg")"
  [ -z "$FROM" ] || body="$body,\"from\":$(json_str "$FROM")"
  [ -z "$TO" ] || body="$body,\"to\":$(json_str "$TO")"
  # Written next to the old one and moved over it: the server never reads half a file.
  printf '%s}\n' "$body" >"$STATUS.tmp.$$" && mv -f "$STATUS.tmp.$$" "$STATUS"
  log "Status for the phone: $state – $msg"
}

healthy() { curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; }
# RaceLens answers within the time given – and still answers 5 seconds later (a version that crashes right after
# starting must not count as a good update).
wait_health() { # seconds
  local deadline=$(($(date +%s) + $1))
  while :; do
    if healthy; then
      sleep 5
      if healthy; then return 0; fi
    fi
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 2
  done
}

# ---------------------------------------------------------------- one update at a time
lock_owner_alive() {
  local pid
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  case "$pid" in
    '' | *[!0-9]*)
      # No pid (yet): another copy that is just starting – unless the lock is more than a minute old.
      [ -z "$(find "$LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ]
      return
      ;;
  esac
  # A lock older than an hour is a leftover whatever its pid says (pids are reused after a restart).
  [ -z "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ] && kill -0 "$pid" 2>/dev/null
}
take_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo "$$" >"$LOCK/pid"; return 0; fi
  lock_owner_alive && return 1
  log "Removing a lock left by an update that did not finish."
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || return 1
  echo "$$" >"$LOCK/pid"
}
if ! take_lock; then
  log "An update is already running – this request is covered by it."
  rm -f "$REQUEST"
  rm -rf "$COPY"
  exit 0
fi
BPID=""
# shellcheck disable=SC2329 # both are called by the traps below
cleanup() { rm -rf "$LOCK" "$COPY"; }
# shellcheck disable=SC2329
on_signal() {
  log "Stopped by a signal."
  if [ -n "$BPID" ]; then kill -TERM -- "-$BPID" 2>/dev/null; fi
  write_status "failed" false "The update was stopped before it finished (was the Mac mini restarted?). Try again. If RaceLens does not work properly, run the one-line install command on the Mac mini."
  exit 1
}
trap cleanup EXIT
trap on_signal TERM INT HUP

# ---------------------------------------------------------------- what is there now
NODE="$(config_value RACELENS_NODE)"
[ -n "$NODE" ] && [ -x "$NODE" ] || NODE="$(command -v node || true)"
PORT="$(config_value RACELENS_PORT)"; PORT="${PORT:-4850}"
REPO="${RACELENS_REPO:-$(version_field repo "$APP/VERSION.json")}"
BRANCH="${RACELENS_BRANCH:-$(version_field branch "$APP/VERSION.json")}"
FROM="$(version_field commit "$APP/VERSION.json")"
BEFORE_ID="$(dir_id "$APP")"
STARTED="$(iso_now)"

WHO="requested from the phone"; [ -z "$BY_HAND" ] || WHO="started by hand"
log "==== Update $WHO. Installed now: ${FROM:-unknown version} (${BRANCH:-default branch}) in $APP"
write_status "running" "" "Downloading and installing the latest RaceLens. This takes a few minutes; RaceLens keeps working meanwhile and restarts by itself at the end."
rm -f "$REQUEST"

# ---------------------------------------------------------------- download, build, swap, restart
export RACELENS_HOME="$HOME_DIR" RACELENS_SUPPORT_DIR="$SUPPORT"
export RACELENS_INSTALL_UNATTENDED=1 RACELENS_SKIP_POWER=1 RACELENS_SELF_UPDATE=1
if [ -n "$REPO" ]; then export RACELENS_REPO="$REPO"; fi
if [ -n "$BRANCH" ]; then export RACELENS_BRANCH="$BRANCH"; fi
# Never set a password from here: install.sh keeps the one in the Keychain.
unset RACELENS_PASSWORD
# launchd's PATH is minimal: put the Node RaceLens runs on first, so the installer uses (and keeps) the same one.
if [ -n "$NODE" ]; then PATH="$(dirname "$NODE"):$PATH"; fi
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

OFFSET="$(wc -c <"$LOG" | tr -d ' ')"
log "Running the installer: download, build in $HOME_DIR/app-new, swap, restart."
# In its own process group, so a hung download or build can be stopped with everything it started.
perl -e 'setpgrp(0, 0); exec @ARGV or die "could not start $ARGV[0]: $!\n"' /bin/bash "$COPY/bootstrap.sh" </dev/null &
BPID=$!
perl -e '($p, $s) = @ARGV; sleep $s; kill "-TERM", $p; sleep 15; kill "-KILL", $p' "$BPID" "$MAX_SECONDS" </dev/null >/dev/null 2>&1 &
WPID=$!
wait "$BPID"
RC=$?
kill "$WPID" 2>/dev/null
wait "$WPID" 2>/dev/null
BPID=""
log "The installer finished with exit code $RC."

# The installer's own words for what went wrong ("RaceLens install stopped: …"), for the phone.
REASON="$(tail -c +"$((OFFSET + 1))" "$LOG" 2>/dev/null | perl -ne 's/\e\[[0-9;]*m//g; if (/RaceLens install stopped: (.*)/) { $r = $1; $r =~ s/\s*\(see above\)//; $r =~ s/[.\s]+$//; print "$r\n" }' | tail -n 1)"
SWAPPED=""
[ "$(dir_id "$APP")" = "$BEFORE_ID" ] || SWAPPED=1
# The new install.sh may have written a different port or Node.
P="$(config_value RACELENS_PORT)"; PORT="${P:-$PORT}"
N="$(config_value RACELENS_NODE)"; if [ -n "$N" ] && [ -x "$N" ]; then NODE="$N"; fi

if [ "$RC" -eq 0 ] && wait_health "$HEALTH_WAIT"; then
  TO="$(version_field commit "$APP/VERSION.json")"
  rm -rf "$HOME_DIR/app-broken"
  if [ -n "$TO" ] && [ "$TO" = "$FROM" ]; then
    write_status "done" true "You already had the latest version ($(short "$TO")). It was installed again and RaceLens is running."
  elif [ -n "$TO" ]; then
    write_status "done" true "RaceLens is up to date (version $(short "$TO")) and running."
  else
    write_status "done" true "RaceLens is up to date and running."
  fi
  exit 0
fi

if [ -z "$SWAPPED" ]; then
  # Stopped before the swap: the version that is running was never touched.
  rm -rf "$HOME_DIR/app-new"
  if [ "$RC" -ge 128 ]; then REASON="the download or build took too long and was stopped"; fi
  if [ "$RC" -eq 0 ]; then REASON="RaceLens did not answer after the update"; fi
  write_status "failed" false "The update could not be installed${REASON:+: $REASON}. Nothing was changed - RaceLens is still running the version you had. Try again later; if it keeps failing, check the Mac mini's internet connection."
  exit 1
fi

# The new version is in place but did not install or start properly: put the previous one back.
TO="$(version_field commit "$APP/VERSION.json")"
log "The new version did not start properly – going back to the previous version."
rollback() {
  [ -d "$HOME_DIR/app-previous" ] || { log "There is no previous version to go back to."; return 1; }
  rm -rf "$HOME_DIR/app-broken"
  if [ -d "$APP" ]; then mv "$APP" "$HOME_DIR/app-broken" || return 1; fi
  mv "$HOME_DIR/app-previous" "$APP" || return 1
  log "Restarting the previous version…"
  RACELENS_NODE="$NODE" perl -e 'alarm shift; exec @ARGV' 300 /bin/bash "$APP/scripts/mac/install.sh" </dev/null ||
    log "The previous version's installer reported a problem (see above)."
  wait_health "$HEALTH_WAIT"
}
if rollback; then
  log "Back on the previous version (the failed one is kept in $HOME_DIR/app-broken)."
  write_status "failed" false "The new version did not start properly, so RaceLens went back to the version you had. Nothing was lost. Try again later."
else
  write_status "failed" false "The new version did not start properly and going back to the previous version did not work either. On the Mac mini, run the one-line install command again (see the RaceLens setup guide)."
fi
exit 1
