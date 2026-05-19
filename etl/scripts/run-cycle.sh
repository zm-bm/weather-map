#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
	etl/scripts/run-cycle.sh --cycle <cycle> [--model <model>] [--procs <n>] [--rebuild] [--dry-run]

Description:
	Refreshes local forecast artifacts by running the same ETL worker container
	used by production Batch. The script runs one local container per configured
	forecast hour and publishes manifests directly into artifacts/.

Options:
	--cycle <cycle>  Forecast cycle string (example: 2026021600)
	--model <model>  Forecast model id (default: gfs)
	--procs <n>  Maximum concurrent local worker containers (default: 1)
	--rebuild  Force a local worker image rebuild before resolving forecast hours
	--dry-run  Prepare the worker image, resolve hours inside it, and print run-hour commands
	-h, --help  Show this help and exit

Environment:
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

print_command() {
	local prefix="$1"
	shift
	printf '%s' "$prefix"
	printf ' %q' "$@"
	printf '\n'
}

CYCLE=""
MODEL="gfs"
PROCS="1"
DRY_RUN="${DRY_RUN:-false}"
FORCE_REBUILD="false"
LOCAL_ETL_IMAGE="${LOCAL_ETL_IMAGE:-weather-map-forecast-etl:local}"
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
		--model)
			require_value "$1" "${2:-}"
			MODEL="$2"
			shift 2
			;;
		--model=*)
			MODEL="${1#*=}"
			require_value "--model" "$MODEL"
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

if [[ ! "$PROCS" =~ ^[0-9]+$ ]]; then
	echo "Error: --procs must be a non-negative integer." >&2
	usage >&2
	exit 1
fi
if [[ "$PROCS" -eq 0 ]]; then
	echo "Error: --procs must be at least 1 for containerized local runs." >&2
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
ARTIFACTS_DIR="$ROOT/artifacts"
CACHE_DIR="$ETL_DIR/cache"
IMAGE_FINGERPRINT_LABEL="org.zmbm.weather-map.forecast-etl.source-fingerprint"

mkdir -p "$ARTIFACTS_DIR" "$CACHE_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "Config file not found: $CONFIG_FILE" >&2
	exit 1
fi
if [[ ! -f "$CONFIG_OVERLAY_FILE" ]]; then
	echo "Config overlay file not found: $CONFIG_OVERLAY_FILE" >&2
	exit 1
fi

require_docker() {
	if ! command -v docker >/dev/null 2>&1; then
		echo "Missing Docker on PATH; local ETL runs use the Batch worker container." >&2
		exit 1
	fi
}

resolve_forecast_hours_with_worker() {
	docker run --rm "$LOCAL_ETL_IMAGE" list-forecast-hours \
		--model "$MODEL" \
		--pipeline-config-overlay-uri file:///app/config/pipeline/local.json
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
	local docker_build_cmd=(
		docker build
		--network=host
		--label "$IMAGE_FINGERPRINT_LABEL=$fingerprint"
		-f "$ETL_DIR/Dockerfile"
		-t "$LOCAL_ETL_IMAGE"
		"$ROOT"
	)
	"${docker_build_cmd[@]}"
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

worker_cmd_for_hour() {
	local fhour="$1"
	local cmd=(
		docker run --rm
		--network host
		--user "$(id -u):$(id -g)"
		--volume "$ARTIFACTS_DIR:/artifacts"
		--volume "$CACHE_DIR:/app/etl/cache"
		--env "ARTIFACT_ROOT_URI=file:///artifacts"
		--env "PIPELINE_CONFIG_OVERLAY_URI=file:///app/config/pipeline/local.json"
		--env "PYTHONDONTWRITEBYTECODE=1"
		--env "MODEL=$MODEL"
		--env "CYCLE=$CYCLE"
		--env "FHOUR=$fhour"
	)

	local optional_env
	for optional_env in \
		ICON_SOURCE_WAIT_SECONDS \
		ICON_SOURCE_MIN_BYTES \
		ICON_SOURCE_RETRY_BASE_SECONDS \
		ICON_SOURCE_RETRY_MAX_SECONDS; do
		if [[ -n "${!optional_env:-}" ]]; then
			cmd+=(--env "$optional_env=${!optional_env}")
		fi
	done

	cmd+=("$LOCAL_ETL_IMAGE" run-hour)
	printf '%s\0' "${cmd[@]}"
}

run_worker_hour() {
	local fhour="$1"
	local cmd=()
	while IFS= read -r -d '' item; do
		cmd+=("$item")
	done < <(worker_cmd_for_hour "$fhour")

	echo "Running local worker container: model=$MODEL cycle=$CYCLE fhour=$fhour"
	if [[ "$DRY_RUN" == "true" ]]; then
		print_command "dry-run:" "${cmd[@]}"
	else
		"${cmd[@]}"
	fi
}

require_docker

echo "Preparing local ETL worker image: $LOCAL_ETL_IMAGE"
prepare_worker_image
mapfile -t FORECAST_HOURS < <(resolve_forecast_hours_with_worker)

if [[ "${#FORECAST_HOURS[@]}" -eq 0 ]]; then
	echo "No forecast hours resolved from config." >&2
	exit 1
fi

echo "Running local containerized pipeline"
echo "  model:          $MODEL"
echo "  cycle:          $CYCLE"
echo "  image:          $LOCAL_ETL_IMAGE"
echo "  forecast_hours: ${#FORECAST_HOURS[@]}"
echo "  procs:          $PROCS"
echo "  start_stagger:  ${ETL_WORKER_STAGGER_SECONDS}s"
echo "  artifacts:      $ARTIFACTS_DIR"
echo "  cache:          $CACHE_DIR"
echo "  dry_run:        $DRY_RUN"

if [[ "$DRY_RUN" == "true" || "$PROCS" -eq 1 ]]; then
	for FHOUR in "${FORECAST_HOURS[@]}"; do
		run_worker_hour "$FHOUR"
	done
else
	ACTIVE_JOBS=0
	FAILURES=0
	STARTED_JOBS=0
	for FHOUR in "${FORECAST_HOURS[@]}"; do
		if [[ "$STARTED_JOBS" -gt 0 && "$ETL_WORKER_STAGGER_SECONDS" != "0" ]]; then
			sleep "$ETL_WORKER_STAGGER_SECONDS"
		fi
		run_worker_hour "$FHOUR" &
		STARTED_JOBS=$((STARTED_JOBS + 1))
		ACTIVE_JOBS=$((ACTIVE_JOBS + 1))
		if [[ "$ACTIVE_JOBS" -ge "$PROCS" ]]; then
			if ! wait -n; then
				FAILURES=1
			fi
			ACTIVE_JOBS=$((ACTIVE_JOBS - 1))
		fi
	done

	while [[ "$ACTIVE_JOBS" -gt 0 ]]; do
		if ! wait -n; then
			FAILURES=1
		fi
		ACTIVE_JOBS=$((ACTIVE_JOBS - 1))
	done

	if [[ "$FAILURES" -ne 0 ]]; then
		echo "One or more local worker containers failed." >&2
		exit 1
	fi
fi

if [[ "$DRY_RUN" == "true" ]]; then
	echo "Dry run complete."
else
	echo "Artifacts are ready in artifacts/ and are served directly by the local dev stack."
fi
