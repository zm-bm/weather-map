#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Refresh tiles + manifests via poll-tiles"

ARTIFACT_SOURCE="$ROOT/etl/out" \
TILESERVER_DIR="$ROOT/tileserver" \
RESTART_ENABLED="false" \
"$ROOT/scripts/poll-tiles.sh"

echo "Done. Restart the compose stack to pick up new tiles if needed."
