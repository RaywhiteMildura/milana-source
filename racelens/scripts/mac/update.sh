#!/bin/bash
# Update RaceLens to the latest version from Terminal on the Mac (same as running the one-line installer again).
# From the phone: Settings → RaceLens version → Update RaceLens (that runs scripts/mac/self-update.sh for you).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
# Run a copy: the update replaces the folder this script lives in.
cp "$SELF_DIR/bootstrap.sh" "$TMP/bootstrap.sh"
exec bash "$TMP/bootstrap.sh"
