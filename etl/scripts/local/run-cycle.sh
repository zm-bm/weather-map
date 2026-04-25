#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
	etl/scripts/local/run-cycle.sh <cycle>

Description:
	Refreshes the local forecast artifacts for the provided cycle and publishes
	manifests directly into artifacts/ for the local dev stack to serve.

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
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ETL_DIR="$ROOT/etl"
VENV_DIR="$ETL_DIR/.venv"
ARTIFACT_ROOT_URI="file://$ROOT/artifacts"
HOST_PYTHON_BIN="${ETL_BOOTSTRAP_PYTHON:-python3}"
VENV_PYTHON_BIN="$VENV_DIR/bin/python"
VENV_PIP_BIN="$VENV_DIR/bin/pip"
REQUIREMENTS_FILE="$ETL_DIR/requirements.txt"
REQUIREMENTS_STAMP="$VENV_DIR/.requirements.txt"
mkdir -p "$ROOT/artifacts"
cd "$ETL_DIR"

require_cmd() {
	local cmd="$1"
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "Error: required command not found: $cmd" >&2
		exit 1
	fi
}

ensure_host_prereqs() {
	require_cmd "$HOST_PYTHON_BIN"

	local missing_gdal=0
	local cmd
	for cmd in gdalinfo gdal_translate gdalwarp; do
		if ! command -v "$cmd" >/dev/null 2>&1; then
			echo "Missing GDAL tool on PATH: $cmd" >&2
			missing_gdal=1
		fi
	done

	if [[ "$missing_gdal" -ne 0 ]]; then
		echo >&2
		echo "Install GDAL CLI tools first, then rerun etl/scripts/local/run-cycle.sh." >&2
		echo "Example (Debian/Ubuntu): sudo apt-get install gdal-bin" >&2
		exit 1
	fi
}

ensure_local_env() {
	ensure_host_prereqs

	if [[ ! -x "$VENV_PYTHON_BIN" ]]; then
		echo "Creating ETL virtual environment: $VENV_DIR"
		"$HOST_PYTHON_BIN" -m venv "$VENV_DIR"
	fi

	if [[ ! -f "$REQUIREMENTS_STAMP" ]] || ! cmp -s "$REQUIREMENTS_FILE" "$REQUIREMENTS_STAMP"; then
		echo "Installing ETL Python dependencies"
		"$VENV_PIP_BIN" install --upgrade pip
		"$VENV_PIP_BIN" install -r "$REQUIREMENTS_FILE"
		cp "$REQUIREMENTS_FILE" "$REQUIREMENTS_STAMP"
	fi
}

ensure_local_env

echo "Running local pipeline for cycle $CYCLE"
"$VENV_PYTHON_BIN" -m gfs_pipeline.cli run-cycle --cycle "$CYCLE" --artifact-root-uri "$ARTIFACT_ROOT_URI"

echo "Artifacts are ready in artifacts/ and are served directly by the local dev stack."
