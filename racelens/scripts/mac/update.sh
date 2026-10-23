#!/bin/bash
# Update RaceLens to the latest version (same as running the one-line installer again).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
# Run a copy: the update replaces the folder this script lives in.
cp "$SELF_DIR/bootstrap.sh" "$TMP/bootstrap.sh"
exec bash "$TMP/bootstrap.sh"
