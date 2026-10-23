#!/bin/bash
# RaceLens one-line installer / updater for a Mac (the Mac mini that serves your phone).
#
#   curl -fsSL https://raw.githubusercontent.com/RaywhiteMildura/milana-source/refs/heads/claude/horse-racing-predictor-ts4iet/racelens/scripts/mac/bootstrap.sh | bash
#
# Run the same line again any time to update. It:
#   1. uses Node.js 22 if this Mac already has it, otherwise downloads a private copy into ~/RaceLens/node
#      (checked against nodejs.org's published checksum; no admin password, nothing installed system-wide);
#   2. downloads the latest RaceLens into ~/RaceLens/app-new, installs and builds it there, and only then swaps it
#      in (the previous version is kept in ~/RaceLens/app-previous) – a failed update never breaks the running copy;
#   3. records what it installed in ~/RaceLens/app/VERSION.json {commit, branch, installedAt};
#   4. runs scripts/mac/install.sh, which sets up the background service, your password, the phone address and
#      the updater that lets you update from your phone (Settings → RaceLens version → Update RaceLens).
# Your research, settings and password are kept in ~/Library/Application Support/RaceLens and the Keychain,
# never in the app folder, so updates do not touch them.
set -euo pipefail

REPO="${RACELENS_REPO:-RaywhiteMildura/milana-source}"
BRANCH="${RACELENS_BRANCH:-claude/horse-racing-predictor-ts4iet}"
HOME_DIR="${RACELENS_HOME:-$HOME/RaceLens}"
SUPPORT="${RACELENS_SUPPORT_DIR:-$HOME/Library/Application Support/RaceLens}"
NODE_MAJOR=22

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mRaceLens install stopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || [ -n "${RACELENS_ALLOW_NON_MAC:-}" ] || die "this installer is for macOS."
mkdir -p "$HOME_DIR"

# An update started from the phone (scripts/mac/self-update.sh) builds in the same folders: never run two at once.
if [ -z "${RACELENS_SELF_UPDATE:-}" ]; then
  LOCK_PID="$(cat "$SUPPORT/update.lock/pid" 2>/dev/null || true)"
  case "$LOCK_PID" in
    '' | *[!0-9]*) ;;
    *) if kill -0 "$LOCK_PID" 2>/dev/null; then die "an update started from your phone is running right now. Wait a few minutes (it finishes by itself), then run this again if you still need to."; fi ;;
  esac
fi

# ---------------------------------------------------------------- Node.js
version_ok() { # $1 = node binary
  "$1" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)" 2>/dev/null
}
NODE=""
if [ -z "${RACELENS_FORCE_PORTABLE_NODE:-}" ] && command -v node >/dev/null 2>&1 && version_ok "$(command -v node)"; then
  NODE="$(command -v node)"
elif [ -x "$HOME_DIR/node/bin/node" ] && version_ok "$HOME_DIR/node/bin/node"; then
  NODE="$HOME_DIR/node/bin/node"
else
  say "Downloading Node.js $NODE_MAJOR (a private copy for RaceLens only)…"
  case "$(uname -m)" in
    arm64) ARCH=arm64 ;;
    x86_64) ARCH=x64 ;;
    *) die "unknown processor $(uname -m)" ;;
  esac
  [ "$(uname -s)" = "Darwin" ] && OS=darwin || OS=linux
  BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || die "could not reach nodejs.org – check the internet connection."
  LINE="$(printf '%s\n' "$SUMS" | grep " node-v${NODE_MAJOR}\.[0-9.]*-${OS}-${ARCH}\.tar\.gz$" | head -1)"
  [ -n "$LINE" ] || die "nodejs.org did not list a Node $NODE_MAJOR download for ${OS}-${ARCH}."
  SUM="${LINE%% *}"; FILE="${LINE##* }"
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE" || die "the Node.js download failed."
  GOT="$( (shasum -a 256 "$TMP/$FILE" 2>/dev/null || sha256sum "$TMP/$FILE") | cut -d' ' -f1)"
  [ "$GOT" = "$SUM" ] || die "the Node.js download did not match its published checksum – not installing it."
  rm -rf "$HOME_DIR/node.new" && mkdir -p "$HOME_DIR/node.new"
  tar -xzf "$TMP/$FILE" -C "$HOME_DIR/node.new" --strip-components 1
  rm -rf "$HOME_DIR/node" && mv "$HOME_DIR/node.new" "$HOME_DIR/node"
  rm -rf "$TMP"
  NODE="$HOME_DIR/node/bin/node"
fi
NODE_DIR="$(dirname "$NODE")"
export PATH="$NODE_DIR:$PATH"
NPM="$NODE_DIR/npm"
[ -x "$NPM" ] || NPM="$(command -v npm)"
echo "Using Node.js $("$NODE" -v) at $NODE"

# ---------------------------------------------------------------- the app
say "Downloading the latest RaceLens ($BRANCH)…"
TMP="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP/src.tar.gz" || die "could not download RaceLens from GitHub."

# Which commit this is (best effort – never stops the install). GitHub's archives carry it in their first header
# (git archive's "comment=<sha>"), which is exactly what was downloaded; otherwise ask the GitHub API; last, the
# archive's top folder (<repo>-<sha> for commit archives).
is_sha() { printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'; }
COMMIT="$(gzip -dc "$TMP/src.tar.gz" 2>/dev/null | head -c 4096 | LC_ALL=C grep -a -o 'comment=[0-9a-f]\{40\}' | head -n 1 | cut -d= -f2 || true)"
if ! is_sha "$COMMIT"; then
  COMMIT="$(curl -fsSL -m 15 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null | head -c 64 || true)"
fi
if ! is_sha "$COMMIT"; then
  COMMIT="$(tar -tzf "$TMP/src.tar.gz" 2>/dev/null | head -n 1 | sed -n 's|^.*-\([0-9a-f]\{40\}\)/.*$|\1|p' || true)"
fi
is_sha "$COMMIT" || COMMIT=""

mkdir -p "$TMP/src" && tar -xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components 1
[ -f "$TMP/src/racelens/package.json" ] || die "the download did not contain the racelens folder."
rm -rf "$HOME_DIR/app-new" && mv "$TMP/src/racelens" "$HOME_DIR/app-new" && rm -rf "$TMP"

say "Installing and building (a few minutes the first time)…"
cd "$HOME_DIR/app-new"
"$NPM" ci --no-audit --no-fund --loglevel=error || die "installing the app's packages failed (see above)."
"$NPM" run build --silent || die "building the app failed (see above)."

# What is installed (shown in status.sh and on the phone under Settings → RaceLens version).
"$NODE" -e '
  const [file, commit, branch, repo] = process.argv.slice(1);
  const v = { commit: commit || undefined, branch, repo, installedAt: new Date().toISOString() };
  require("fs").writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
' "$HOME_DIR/app-new/VERSION.json" "$COMMIT" "$BRANCH" "$REPO" || echo "(Could not record the version number – carrying on.)"
echo "Version: ${COMMIT:-unknown} ($BRANCH)"

# Swap only after a successful build, keeping the previous version for a quick roll-back.
cd "$HOME_DIR"
if [ -d app ]; then rm -rf app-previous && mv app app-previous; fi
mv app-new app

# install.sh sets up the updater for this same folder, repository and branch.
export RACELENS_NODE="$NODE" RACELENS_HOME="$HOME_DIR" RACELENS_REPO="$REPO" RACELENS_BRANCH="$BRANCH"
exec bash "$HOME_DIR/app/scripts/mac/install.sh"
