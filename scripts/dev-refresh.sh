#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
	scripts/dev-refresh.sh <cycle>

Description:
	Runs ETL dev processing for the provided forecast cycle, publishes artifacts/manifests,
	and refreshes local tileserver assets via scripts/poll-tiles.sh.

Arguments:
	<cycle>   Forecast cycle string (examples: 2026021600)

Options:
	-h, --help  Show this help and exit
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
	usage
	exit 0
fi

if [[ $# -ne 1 ]]; then
	echo "Error: expected exactly one <cycle> argument." >&2
	usage >&2
	exit 1
fi

CYCLE="$1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/etl"

echo "Running local pipeline for cycle $CYCLE"
python -m gfs_pipeline.cli dev-run --cycle "$CYCLE"

echo "Publishing artifacts for cycle $CYCLE to etl/out"
python -m gfs_pipeline.cli publish --cycle "$CYCLE"

echo "Copying fresh artifacts into tileserver paths"
ARTIFACT_SOURCE="$ROOT/etl/out" \
TILESERVER_DIR="$ROOT/tileserver" \
RESTART_ENABLED="false" \
"$ROOT/scripts/poll-tiles.sh"

echo "Restarting local docker compose services"
docker compose -f "$ROOT/compose.dev.yml" restart

echo "Done."
