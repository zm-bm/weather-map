#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
	etl/scripts/run-cycle.sh --cycle <cycle> [--run-id <run_id>] [--dataset-id <dataset_id>] [--frames <frames>] [--artifact <id>] [--procs <n>] [--no-publish] [--rebuild] [--dry-run]

Description:
	Refreshes local artifacts by executing the shared ETL cycle plan with the
	production worker container. When --dataset-id is omitted, every configured
	dataset is refreshed sequentially.

Options:
	--cycle <cycle>  Cycle string (example: 2026021600)
	--run-id <run_id>  Run id for this cycle attempt (default: generated)
	--dataset-id <dataset_id>  Dataset id (default: all configured datasets)
	--frames <frames>  Frame override, e.g. "000 001 006" or "000,001,006"
	--artifact <id>  Artifact id to process; repeat to process multiple artifacts
	--procs <n>  Maximum concurrent local worker containers (default: 1)
	--no-publish  Skip the final manifest publish step
	--rebuild  Force a local worker image rebuild
	--dry-run  Print planned containers without writing artifacts
	-h, --help  Show this help and exit

Environment:
	RUN_ID  Run id override; same format as --run-id
	ETL_CODE_REVISION  Code revision recorded in run metadata and success markers
	ETL_IMAGE_IDENTITY  Image identity recorded in run metadata and success markers
	LOCAL_ETL_IMAGE  Local worker image tag (default: weather-map-forecast-etl:local)
	ETL_WORKER_STAGGER_SECONDS  Delay between parallel worker starts (default: 5)
EOF
}

require_value() {
	local flag="$1"
	local value="${2:-}"
	if [[ -z "$value" || "$value" == -* ]]; then
		echo "Error: $flag requires a value." >&2
		usage >&2
		exit 1
	fi
}

CYCLE=""
RUN_ID="${RUN_ID:-}"
SELECTED_DATASET=""
FRAMES_ARG="${FRAMES:-}"
SELECTED_ARTIFACTS=()
PROCS="1"
DRY_RUN="${DRY_RUN:-false}"
FORCE_REBUILD="false"
NO_PUBLISH="false"
LOCAL_ETL_IMAGE="${LOCAL_ETL_IMAGE:-weather-map-forecast-etl:local}"
ETL_CODE_REVISION="${ETL_CODE_REVISION:-}"
ETL_IMAGE_IDENTITY="${ETL_IMAGE_IDENTITY:-}"
ETL_WORKER_STAGGER_SECONDS="${ETL_WORKER_STAGGER_SECONDS:-5}"

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h|--help)
			usage
			exit 0
			;;
		--cycle)
			require_value "$1" "${2:-}"
			CYCLE="$2"
			shift 2
			;;
		--cycle=*)
			CYCLE="${1#*=}"
			require_value "--cycle" "$CYCLE"
			shift
			;;
		--run-id)
			require_value "$1" "${2:-}"
			RUN_ID="$2"
			shift 2
			;;
		--run-id=*)
			RUN_ID="${1#*=}"
			require_value "--run-id" "$RUN_ID"
			shift
			;;
		--dataset-id)
			require_value "$1" "${2:-}"
			SELECTED_DATASET="$2"
			shift 2
			;;
		--dataset-id=*)
			SELECTED_DATASET="${1#*=}"
			require_value "--dataset-id" "$SELECTED_DATASET"
			shift
			;;
		--frames)
			require_value "$1" "${2:-}"
			FRAMES_ARG="$2"
			shift 2
			;;
		--frames=*)
			FRAMES_ARG="${1#*=}"
			require_value "--frames" "$FRAMES_ARG"
			shift
			;;
		--artifact)
			require_value "$1" "${2:-}"
			SELECTED_ARTIFACTS+=("$2")
			shift 2
			;;
		--artifact=*)
			artifact="${1#*=}"
			require_value "--artifact" "$artifact"
			SELECTED_ARTIFACTS+=("$artifact")
			shift
			;;
		--procs)
			require_value "$1" "${2:-}"
			PROCS="$2"
			shift 2
			;;
		--procs=*)
			PROCS="${1#*=}"
			require_value "--procs" "$PROCS"
			shift
			;;
		--dry-run)
			DRY_RUN="true"
			shift
			;;
		--no-publish)
			NO_PUBLISH="true"
			shift
			;;
		--rebuild)
			FORCE_REBUILD="true"
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
if [[ ! "$CYCLE" =~ ^[0-9]{10}$ ]]; then
	echo "Error: --cycle must be YYYYMMDDHH, got: $CYCLE" >&2
	exit 1
fi
if [[ -z "$RUN_ID" ]]; then
	RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$CYCLE-$$-${RANDOM:-0}-$(date +%s%N)" | sha256sum | awk '{print substr($1,1,8)}')"
fi
if [[ ! "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]]; then
	echo "Error: --run-id must match YYYYMMDDTHHMMSSZ-<8 lowercase hex chars>, got: $RUN_ID" >&2
	exit 1
fi
if [[ ! "$PROCS" =~ ^[0-9]+$ || "$PROCS" -eq 0 ]]; then
	echo "Error: --procs must be a positive integer." >&2
	exit 1
fi
if [[ ! "$ETL_WORKER_STAGGER_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
	echo "Error: ETL_WORKER_STAGGER_SECONDS must be a non-negative number." >&2
	exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ETL_DIR="$ROOT/etl"
CONFIG_FILE="$ROOT/config/pipeline/base.json"
CONFIG_OVERLAY_FILE="$ROOT/config/pipeline/local.json"
CATALOG_FILE="$ROOT/config/forecast_catalog.json"
ARTIFACTS_DIR="$ROOT/artifacts"
CACHE_DIR="$ETL_DIR/cache"
IMAGE_FINGERPRINT_LABEL="org.zmbm.weather-map.forecast-etl.source-fingerprint"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
	PYTHON_BIN="python3"
fi

if [[ -z "$ETL_CODE_REVISION" ]]; then
	ETL_CODE_REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
fi
if [[ -z "$ETL_IMAGE_IDENTITY" ]]; then
	ETL_IMAGE_IDENTITY="$LOCAL_ETL_IMAGE"
fi

mkdir -p "$ARTIFACTS_DIR" "$CACHE_DIR"

require_docker() {
	if ! command -v docker >/dev/null 2>&1; then
		echo "Missing Docker on PATH; local ETL runs use the Batch worker container." >&2
		exit 1
	fi
}

image_source_fingerprint() {
	(
		cd "$ROOT"
		{
			printf '%s\0' \
				config/forecast_catalog.json \
				config/pipeline/base.json \
				config/pipeline/local.json \
				etl/Dockerfile \
				etl/pyproject.toml
			find etl/forecast_etl \
				-type f \
				! -path '*/__pycache__/*' \
				! -name '*.pyc' \
				-print0
		} | LC_ALL=C sort -z | xargs -0 sha256sum
	) | sha256sum | awk '{print $1}'
}

inspect_image_fingerprint() {
	docker image inspect \
		--format "{{ index .Config.Labels \"$IMAGE_FINGERPRINT_LABEL\" }}" \
		"$LOCAL_ETL_IMAGE" 2>/dev/null
}

build_worker_image() {
	local fingerprint="$1"
	docker build \
		--network=host \
		--build-arg "ETL_CODE_REVISION=$ETL_CODE_REVISION" \
		--build-arg "ETL_IMAGE_IDENTITY=$LOCAL_ETL_IMAGE@$fingerprint" \
		--label "$IMAGE_FINGERPRINT_LABEL=$fingerprint" \
		-f "$ETL_DIR/Dockerfile" \
		-t "$LOCAL_ETL_IMAGE" \
		"$ROOT"
}

prepare_worker_image() {
	local expected_fingerprint
	local current_fingerprint
	local build_reason
	expected_fingerprint="$(image_source_fingerprint)"
	if [[ "$FORCE_REBUILD" == "true" ]]; then
		build_reason="forced by --rebuild"
	elif ! current_fingerprint="$(inspect_image_fingerprint)"; then
		build_reason="image is missing"
	elif [[ -z "$current_fingerprint" || "$current_fingerprint" == "<no value>" ]]; then
		build_reason="image has no source fingerprint"
	elif [[ "$current_fingerprint" != "$expected_fingerprint" ]]; then
		build_reason="ETL image inputs changed"
	else
		echo "Worker image is current; skipping rebuild."
		return 0
	fi
	echo "Building worker image ($build_reason)."
	build_worker_image "$expected_fingerprint"
}

require_docker
echo "Preparing local ETL worker image: $LOCAL_ETL_IMAGE"
prepare_worker_image

cmd=(
	"$PYTHON_BIN" -m forecast_etl.cli execute-local-cycle
	--cycle "$CYCLE"
	--run-id "$RUN_ID"
	--artifact-root-uri "file://$ARTIFACTS_DIR"
	--pipeline-config-uri "file://$CONFIG_FILE"
	--pipeline-config-overlay-uri "file://$CONFIG_OVERLAY_FILE"
	--forecast-catalog-uri "file://$CATALOG_FILE"
	--artifacts-dir "$ARTIFACTS_DIR"
	--cache-dir "$CACHE_DIR"
	--local-image "$LOCAL_ETL_IMAGE"
	--procs "$PROCS"
	--worker-stagger-seconds "$ETL_WORKER_STAGGER_SECONDS"
)
if [[ -n "$SELECTED_DATASET" ]]; then
	cmd+=(--dataset-id "$SELECTED_DATASET")
fi
if [[ -n "$FRAMES_ARG" ]]; then
	cmd+=(--frames "$FRAMES_ARG")
fi
if [[ "$DRY_RUN" == "true" ]]; then
	cmd+=(--dry-run)
fi
if [[ "$NO_PUBLISH" == "true" ]]; then
	cmd+=(--no-publish)
fi
for artifact in "${SELECTED_ARTIFACTS[@]}"; do
	cmd+=(--artifact "$artifact")
done

PYTHONPATH="$ROOT/etl${PYTHONPATH:+:$PYTHONPATH}" \
ETL_CODE_REVISION="$ETL_CODE_REVISION" \
ETL_IMAGE_IDENTITY="$ETL_IMAGE_IDENTITY" \
	"${cmd[@]}"
