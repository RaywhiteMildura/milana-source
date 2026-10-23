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
#   3. runs scripts/mac/install.sh, which sets up the background service, your password and the phone address.
# Your research, settings and password are kept in ~/Library/Application Support/RaceLens and the Keychain,
# never in the app folder, so updates do not touch them.
set -euo pipefail

REPO="${RACELENS_REPO:-RaywhiteMildura/milana-source}"
BRANCH="${RACELENS_BRANCH:-claude/horse-racing-predictor-ts4iet}"
HOME_DIR="${RACELENS_HOME:-$HOME/RaceLens}"
NODE_MAJOR=22

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mRaceLens install stopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || [ -n "${RACELENS_ALLOW_NON_MAC:-}" ] || die "this installer is for macOS."
mkdir -p "$HOME_DIR"

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
mkdir -p "$TMP/src" && tar -xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components 1
[ -f "$TMP/src/racelens/package.json" ] || die "the download did not contain the racelens folder."
rm -rf "$HOME_DIR/app-new" && mv "$TMP/src/racelens" "$HOME_DIR/app-new" && rm -rf "$TMP"

say "Installing and building (a few minutes the first time)…"
cd "$HOME_DIR/app-new"
"$NPM" ci --no-audit --no-fund --loglevel=error || die "installing the app's packages failed (see above)."
"$NPM" run build --silent || die "building the app failed (see above)."

# Swap only after a successful build, keeping the previous version for a quick roll-back.
cd "$HOME_DIR"
if [ -d app ]; then rm -rf app-previous && mv app app-previous; fi
mv app-new app

export RACELENS_NODE="$NODE"
exec bash "$HOME_DIR/app/scripts/mac/install.sh"
