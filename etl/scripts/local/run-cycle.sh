#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
	etl/scripts/local/run-cycle.sh --cycle <cycle> [--model <model>] [--procs <n>]

Description:
	Refreshes the local forecast artifacts for the provided cycle and publishes
	manifests directly into artifacts/ for the local dev stack to serve.

Options:
	--cycle <cycle>  Forecast cycle string (example: 2026021600)
	--model <model>  Forecast model id (default: gfs)
	--procs <n>  Process count passed to forecast-etl run-cycle (default: 4, or 1 for ICON)
	-h, --help  Show this help and exit
EOF
}

CYCLE=""
MODEL="gfs"
PROCS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h|--help)
			usage
			exit 0
			;;
		--cycle)
			if [[ $# -lt 2 || "${2:-}" == -* ]]; then
				echo "Error: --cycle requires a value." >&2
				usage >&2
				exit 1
			fi
			CYCLE="$2"
			shift 2
			;;
		--cycle=*)
			CYCLE="${1#*=}"
			if [[ -z "$CYCLE" ]]; then
				echo "Error: --cycle requires a value." >&2
				usage >&2
				exit 1
			fi
			shift
			;;
		--model)
			if [[ $# -lt 2 || "${2:-}" == -* ]]; then
				echo "Error: --model requires a value." >&2
				usage >&2
				exit 1
			fi
			MODEL="$2"
			shift 2
			;;
		--model=*)
			MODEL="${1#*=}"
			if [[ -z "$MODEL" ]]; then
				echo "Error: --model requires a value." >&2
				usage >&2
				exit 1
			fi
			shift
			;;
		--procs)
			if [[ $# -lt 2 || "${2:-}" == -* ]]; then
				echo "Error: --procs requires a value." >&2
				usage >&2
				exit 1
			fi
			PROCS="$2"
			shift 2
			;;
		--procs=*)
			PROCS="${1#*=}"
			if [[ -z "$PROCS" ]]; then
				echo "Error: --procs requires a value." >&2
				usage >&2
				exit 1
			fi
			shift
			;;
		*)
			echo "Error: unexpected argument: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ -z "$CYCLE" ]]; then
	echo "Error: --cycle <cycle> is required." >&2
	usage >&2
	exit 1
fi

if [[ -n "$PROCS" ]] && ! [[ "$PROCS" =~ ^[0-9]+$ ]]; then
	echo "Error: --procs must be a non-negative integer." >&2
	usage >&2
	exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ETL_DIR="$ROOT/etl"
VENV_DIR="$ETL_DIR/.venv"
ARTIFACT_ROOT_URI="file://$ROOT/artifacts"
FORECAST_ETL_BIN="$VENV_DIR/bin/forecast-etl"
mkdir -p "$ROOT/artifacts"

check_host_prereqs() {
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

	if [[ "$MODEL" == "icon" ]] && ! command -v docker >/dev/null 2>&1; then
		echo "Missing Docker on PATH; ICON local runs need Docker for deutscherwetterdienst/regrid:icon." >&2
		exit 1
	fi
}

bootstrap_if_needed() {
	if [[ ! -x "$FORECAST_ETL_BIN" ]]; then
		"$ETL_DIR/scripts/local/bootstrap.sh"
	fi
}

check_host_prereqs
bootstrap_if_needed

echo "Running local pipeline for model $MODEL cycle $CYCLE"
CMD=("$FORECAST_ETL_BIN" run-cycle --model "$MODEL" --cycle "$CYCLE" --artifact-root-uri "$ARTIFACT_ROOT_URI")
if [[ -n "$PROCS" ]]; then
	CMD+=(--procs "$PROCS")
fi
"${CMD[@]}"

echo "Artifacts are ready in artifacts/ and are served directly by the local dev stack."
