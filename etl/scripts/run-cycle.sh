#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
	etl/scripts/run-cycle.sh --cycle <cycle> [--run-id <run_id>] [--model <model>] [--artifact <id>] [--procs <n>] [--no-publish] [--rebuild] [--dry-run]

Description:
	Refreshes local forecast artifacts by running the same ETL worker container
	used by production Batch. The script runs one local container per configured
	forecast hour, then publishes manifests once into artifacts/. When --model
	is omitted, every configured model is refreshed sequentially.

Options:
	--cycle <cycle>  Forecast cycle string (example: 2026021600)
	--run-id <run_id>  Run id for this cycle attempt (default: generated)
	--model <model>  Forecast model id (default: all configured models)
	--artifact <id>  Artifact id to process; repeat to process multiple artifacts
	--procs <n>  Maximum concurrent local worker containers (default: 1)
	--no-publish  Skip the final manifest publish step
	--rebuild  Force a local worker image rebuild before resolving forecast hours
	--dry-run  Prepare the worker image, resolve hours inside it, and print run-hour commands
	-h, --help  Show this help and exit

Environment:
	RUN_ID  Run id override; same format as --run-id
	ETL_CODE_REVISION  Code revision recorded in success markers
	ETL_IMAGE_IDENTITY  Image identity recorded in success markers
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
RUN_ID="${RUN_ID:-}"
SELECTED_MODEL=""
SELECTED_ARTIFACTS=()
PROCS="1"
DRY_RUN="${DRY_RUN:-false}"
FORCE_REBUILD="false"
NO_PUBLISH="false"
LOCAL_ETL_IMAGE="${LOCAL_ETL_IMAGE:-weather-map-forecast-etl:local}"
ETL_CODE_REVISION="${ETL_CODE_REVISION:-}"
ETL_IMAGE_IDENTITY="${ETL_IMAGE_IDENTITY:-}"
ETL_WORKER_STAGGER_SECONDS="${ETL_WORKER_STAGGER_SECONDS:-5}"
artifact=""

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
		--model)
			require_value "$1" "${2:-}"
			SELECTED_MODEL="$2"
			shift 2
			;;
		--model=*)
			SELECTED_MODEL="${1#*=}"
			require_value "--model" "$SELECTED_MODEL"
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
RUN_LOG_DIR=""
FAILURE_DIR=""
RUN_PIPELINE_CONFIG_URI=""
RUN_FORECAST_CATALOG_URI=""

if [[ -z "$ETL_CODE_REVISION" ]]; then
	ETL_CODE_REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
fi
if [[ -z "$ETL_IMAGE_IDENTITY" ]]; then
	ETL_IMAGE_IDENTITY="$LOCAL_ETL_IMAGE"
fi

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

list_model_ids_with_worker() {
	docker run --rm "$LOCAL_ETL_IMAGE" list-models \
		--pipeline-config-overlay-uri file:///app/config/pipeline/local.json
}

resolve_forecast_hours_with_worker() {
	local model="$1"
	local pipeline_config_uri="$2"

	if [[ "$DRY_RUN" == "true" ]]; then
		docker run --rm "$LOCAL_ETL_IMAGE" list-forecast-hours \
			--model "$model" \
			--pipeline-config-overlay-uri file:///app/config/pipeline/local.json
	else
		docker run --rm "$LOCAL_ETL_IMAGE" list-forecast-hours \
			--model "$model" \
			--pipeline-config-uri "$pipeline_config_uri"
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
	local docker_build_cmd=(
		docker build
		--network=host
		--build-arg "ETL_CODE_REVISION=$ETL_CODE_REVISION"
		--build-arg "ETL_IMAGE_IDENTITY=$LOCAL_ETL_IMAGE@$fingerprint"
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
	local model="$1"
	local fhour="$2"
	local artifact
	local cmd=(
		docker run --rm
		--network host
		--user "$(id -u):$(id -g)"
		--volume "$ARTIFACTS_DIR:/artifacts"
		--volume "$CACHE_DIR:/app/etl/cache"
		--env "ARTIFACT_ROOT_URI=file:///artifacts"
		--env "PIPELINE_CONFIG_URI=$RUN_PIPELINE_CONFIG_URI"
		--env "FORECAST_CATALOG_URI=$RUN_FORECAST_CATALOG_URI"
		--env "PYTHONDONTWRITEBYTECODE=1"
		--env "MODEL=$model"
		--env "CYCLE=$CYCLE"
		--env "RUN_ID=$RUN_ID"
		--env "FHOUR=$fhour"
		--env "ETL_CODE_REVISION=$ETL_CODE_REVISION"
		--env "ETL_IMAGE_IDENTITY=$ETL_IMAGE_IDENTITY"
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
	for artifact in "${SELECTED_ARTIFACTS[@]}"; do
		cmd+=(--artifact "$artifact")
	done
	printf '%s\0' "${cmd[@]}"
}

init_run_cmd_for_model() {
	local model="$1"
	local cmd=(
		docker run --rm
		--network host
		--user "$(id -u):$(id -g)"
		--volume "$ARTIFACTS_DIR:/artifacts"
		--env "ARTIFACT_ROOT_URI=file:///artifacts"
		--env "PYTHONDONTWRITEBYTECODE=1"
		--env "MODEL=$model"
		--env "CYCLE=$CYCLE"
		--env "RUN_ID=$RUN_ID"
		--env "ETL_CODE_REVISION=$ETL_CODE_REVISION"
		--env "ETL_IMAGE_IDENTITY=$ETL_IMAGE_IDENTITY"
		"$LOCAL_ETL_IMAGE" init-run
		--cycle "$CYCLE"
		--run-id "$RUN_ID"
		--pipeline-config-overlay-uri file:///app/config/pipeline/local.json
	)
	printf '%s\0' "${cmd[@]}"
}

publish_cmd_for_model() {
	local model="$1"
	local cmd=(
		docker run --rm
		--network host
		--user "$(id -u):$(id -g)"
		--volume "$ARTIFACTS_DIR:/artifacts"
		--env "ARTIFACT_ROOT_URI=file:///artifacts"
		--env "PIPELINE_CONFIG_URI=$RUN_PIPELINE_CONFIG_URI"
		--env "FORECAST_CATALOG_URI=$RUN_FORECAST_CATALOG_URI"
		--env "PYTHONDONTWRITEBYTECODE=1"
		--env "MODEL=$model"
		--env "CYCLE=$CYCLE"
		--env "RUN_ID=$RUN_ID"
		--env "ETL_CODE_REVISION=$ETL_CODE_REVISION"
		--env "ETL_IMAGE_IDENTITY=$ETL_IMAGE_IDENTITY"
		"$LOCAL_ETL_IMAGE" publish-cycle
		--cycle "$CYCLE"
		--run-id "$RUN_ID"
	)
	printf '%s\0' "${cmd[@]}"
}

init_run_for_model() {
	local model="$1"
	local cmd=()
	local output=""
	local key
	local value
	RUN_PIPELINE_CONFIG_URI=""
	RUN_FORECAST_CATALOG_URI=""

	while IFS= read -r -d '' item; do
		cmd+=("$item")
	done < <(init_run_cmd_for_model "$model")

	echo "Initializing local run snapshot: model=$model cycle=$CYCLE"
	if [[ "$DRY_RUN" == "true" ]]; then
		print_command "dry-run:" "${cmd[@]}"
		RUN_PIPELINE_CONFIG_URI="file:///artifacts/runs/$model/$CYCLE/$RUN_ID/config/pipeline_config.json"
		RUN_FORECAST_CATALOG_URI="file:///artifacts/runs/$model/$CYCLE/$RUN_ID/config/forecast_catalog.json"
		echo "  pipeline_config_uri: $RUN_PIPELINE_CONFIG_URI"
		echo "  forecast_catalog_uri: $RUN_FORECAST_CATALOG_URI"
		return 0
	fi
	output="$("${cmd[@]}")"
	while IFS='=' read -r key value; do
		case "$key" in
			pipeline_config_uri) RUN_PIPELINE_CONFIG_URI="$value" ;;
			forecast_catalog_uri) RUN_FORECAST_CATALOG_URI="$value" ;;
		esac
	done <<< "$output"

	if [[ -z "$RUN_PIPELINE_CONFIG_URI" || -z "$RUN_FORECAST_CATALOG_URI" ]]; then
		echo "init-run did not return snapshot config/catalog URIs." >&2
		echo "$output" >&2
		exit 1
	fi
	echo "  pipeline_config_uri: $RUN_PIPELINE_CONFIG_URI"
	echo "  forecast_catalog_uri: $RUN_FORECAST_CATALOG_URI"
}

run_worker_hour() {
	local model="$1"
	local fhour="$2"
	local cmd=()
	local log_path=""
	local status
	while IFS= read -r -d '' item; do
		cmd+=("$item")
	done < <(worker_cmd_for_hour "$model" "$fhour")

	echo "Running local worker container: model=$model cycle=$CYCLE fhour=$fhour"
	if [[ "$DRY_RUN" == "true" ]]; then
		print_command "dry-run:" "${cmd[@]}"
	else
		log_path="$RUN_LOG_DIR/worker-${model}-${CYCLE}-${fhour}.log"
		: > "$log_path"
		if "${cmd[@]}" > >(tee -a "$log_path") 2> >(tee -a "$log_path" >&2); then
			return 0
		else
			status=$?
		fi
		{
			printf 'fhour=%s\n' "$fhour"
			printf 'exit_status=%s\n' "$status"
			printf 'log_path=%s\n' "$log_path"
		} > "$FAILURE_DIR/$fhour.status"
		return "$status"
	fi
}

run_publish_cycle() {
	local model="$1"
	local cmd=()
	while IFS= read -r -d '' item; do
		cmd+=("$item")
	done < <(publish_cmd_for_model "$model")

	echo "Publishing local cycle manifest: model=$model cycle=$CYCLE"
	if [[ "$DRY_RUN" == "true" ]]; then
		print_command "dry-run:" "${cmd[@]}"
	else
		"${cmd[@]}"
	fi
}

print_worker_failure_summary() {
	local model="$1"
	local failure_file
	local failure_files=()
	local fhour=""
	local exit_status=""
	local log_path=""
	local key
	local value

	while IFS= read -r -d '' failure_file; do
		failure_files+=("$failure_file")
	done < <(find "$FAILURE_DIR" -maxdepth 1 -type f -name '*.status' -print0 | LC_ALL=C sort -z)

	if [[ "${#failure_files[@]}" -eq 0 ]]; then
		echo "One or more local worker containers failed, but no failure details were captured." >&2
		echo "Worker logs: $RUN_LOG_DIR" >&2
		return
	fi

	echo "Failed local worker containers:" >&2
	for failure_file in "${failure_files[@]}"; do
		fhour=""
		exit_status=""
		log_path=""
		while IFS='=' read -r key value; do
			case "$key" in
				fhour) fhour="$value" ;;
				exit_status) exit_status="$value" ;;
				log_path) log_path="$value" ;;
			esac
		done < "$failure_file"

		echo "- model=$model cycle=$CYCLE fhour=$fhour exit=$exit_status" >&2
		echo "  log: $log_path" >&2
		if [[ -f "$log_path" ]]; then
			echo "  tail:" >&2
			tail -n 40 "$log_path" | sed 's/^/    /' >&2
		fi
	done
}

run_forecast_hours() {
	local model="$1"
	shift
	local FORECAST_HOURS=("$@")
	local FHOUR
	local FAILURES
	local ACTIVE_JOBS
	local STARTED_JOBS

	if [[ "$DRY_RUN" == "true" ]]; then
		for FHOUR in "${FORECAST_HOURS[@]}"; do
			run_worker_hour "$model" "$FHOUR"
		done
	elif [[ "$PROCS" -eq 1 ]]; then
		FAILURES=0
		for FHOUR in "${FORECAST_HOURS[@]}"; do
			if ! run_worker_hour "$model" "$FHOUR"; then
				FAILURES=1
				break
			fi
		done

		if [[ "$FAILURES" -ne 0 ]]; then
			print_worker_failure_summary "$model"
			return 1
		fi
	else
		ACTIVE_JOBS=0
		FAILURES=0
		STARTED_JOBS=0
		for FHOUR in "${FORECAST_HOURS[@]}"; do
			if [[ "$STARTED_JOBS" -gt 0 && "$ETL_WORKER_STAGGER_SECONDS" != "0" ]]; then
				sleep "$ETL_WORKER_STAGGER_SECONDS"
			fi
			run_worker_hour "$model" "$FHOUR" &
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
			print_worker_failure_summary "$model"
			return 1
		fi
	fi
}

run_model_cycle() {
	local model="$1"
	local FORECAST_HOURS=()

	RUN_LOG_DIR=""
	FAILURE_DIR=""

	init_run_for_model "$model"

	mapfile -t FORECAST_HOURS < <(resolve_forecast_hours_with_worker "$model" "$RUN_PIPELINE_CONFIG_URI")

	if [[ "${#FORECAST_HOURS[@]}" -eq 0 ]]; then
		echo "No forecast hours resolved from config for model=$model." >&2
		exit 1
	fi

	echo "Running local containerized pipeline"
	echo "  model:          $model"
	echo "  cycle:          $CYCLE"
	echo "  run_id:         $RUN_ID"
	echo "  config:         $RUN_PIPELINE_CONFIG_URI"
	echo "  catalog:        $RUN_FORECAST_CATALOG_URI"
	echo "  image:          $LOCAL_ETL_IMAGE"
	echo "  forecast_hours: ${#FORECAST_HOURS[@]}"
	if [[ "${#SELECTED_ARTIFACTS[@]}" -gt 0 ]]; then
		echo "  selected_artifacts: ${SELECTED_ARTIFACTS[*]}"
	fi
	echo "  procs:          $PROCS"
	echo "  start_stagger:  ${ETL_WORKER_STAGGER_SECONDS}s"
	echo "  artifacts:      $ARTIFACTS_DIR"
	echo "  cache:          $CACHE_DIR"
	echo "  dry_run:        $DRY_RUN"
	echo "  no_publish:     $NO_PUBLISH"

	if [[ "$DRY_RUN" != "true" ]]; then
		RUN_LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-run-cycle-${model}-${CYCLE}.XXXXXX")"
		FAILURE_DIR="$RUN_LOG_DIR/failures"
		mkdir -p "$FAILURE_DIR"
		echo "  worker_logs:    $RUN_LOG_DIR"
	fi

	run_forecast_hours "$model" "${FORECAST_HOURS[@]}" || exit 1
	if [[ "$NO_PUBLISH" != "true" ]]; then
		run_publish_cycle "$model"
	fi
}

require_docker

echo "Preparing local ETL worker image: $LOCAL_ETL_IMAGE"
prepare_worker_image

MODEL_IDS=()
if [[ -n "$SELECTED_MODEL" ]]; then
	MODEL_IDS=("$SELECTED_MODEL")
else
	mapfile -t MODEL_IDS < <(list_model_ids_with_worker)
fi

if [[ "${#MODEL_IDS[@]}" -eq 0 ]]; then
	echo "No models resolved from config." >&2
	exit 1
fi

if [[ -z "$SELECTED_MODEL" ]]; then
	echo "models: ${MODEL_IDS[*]}"
fi

for MODEL_ID in "${MODEL_IDS[@]}"; do
	run_model_cycle "$MODEL_ID"
done

if [[ "$DRY_RUN" == "true" ]]; then
	echo "Dry run complete."
else
	echo "Artifacts are ready in artifacts/ and are served directly by the local dev stack."
fi
