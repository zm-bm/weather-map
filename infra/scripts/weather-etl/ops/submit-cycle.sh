#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/.." && pwd)"
STACK_DIR="$INFRA_DIR/terraform/weather-etl"

usage() {
  cat <<'EOF'
Usage:
  infra/scripts/weather-etl/ops/submit-cycle.sh --cycle <cycle> [--run-id <run_id>] [--dataset-id <dataset_id>]

Description:
  Submits one AWS Batch worker job per configured frame for a prod ETL
  cycle. This mirrors etl/scripts/run-cycle.sh, but submits jobs to AWS Batch
  instead of running the ETL locally.

Options:
  --cycle <cycle>                 Forecast cycle string, e.g. 2026021600.
  --run-id <run_id>               Run id for this cycle attempt. Default: generated.
  --dataset-id <dataset_id>       Dataset id. Default: gfs.
  --frames <frames>               Frame override, e.g. "000 001 006" or "000,001,006".
  --config-file <path>            Config to read. Default: config/pipeline/base.json.
  --source-bucket <bucket>        NOAA GFS source bucket. Default: noaa-gfs-bdp-pds.
  --job-name-prefix <prefix>      Batch job name prefix. Default: weather-etl-manual.
  --submit-delay-seconds <n>      Delay between submissions. Default: 0.
  --dry-run                       Print jobs without submitting.
  --backfill                      Allow submitting a cycle older than current latest.
  --skip-config-check             Skip local-vs-S3 config md5 check.
  --allow-non-synoptic-cycle      Allow cycles outside 00/06/12/18.
  -h, --help                      Show this help and exit.

Environment defaults:
  CYCLE, RUN_ID, DATASET_ID, FRAMES, CONFIG_FILE, CATALOG_FILE, SOURCE_BUCKET, JOB_NAME_PREFIX,
  SUBMIT_DELAY_SECONDS, DRY_RUN, BACKFILL, SKIP_CONFIG_CHECK, ALLOW_NON_SYNOPTIC_CYCLE,
  ETL_CODE_REVISION, ETL_IMAGE_IDENTITY.
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
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

CYCLE="${CYCLE:-}"
RUN_ID="${RUN_ID:-}"
DATASET_ID="${DATASET_ID:-gfs}"
FRAMES_ARG="${FRAMES:-}"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/pipeline/base.json}"
CATALOG_FILE="${CATALOG_FILE:-$REPO_ROOT/config/forecast_catalog.json}"
SOURCE_BUCKET="${SOURCE_BUCKET:-noaa-gfs-bdp-pds}"
JOB_NAME_PREFIX="${JOB_NAME_PREFIX:-weather-etl-manual}"
SUBMIT_DELAY_SECONDS="${SUBMIT_DELAY_SECONDS:-0}"
DRY_RUN="${DRY_RUN:-false}"
BACKFILL="${BACKFILL:-false}"
SKIP_CONFIG_CHECK="${SKIP_CONFIG_CHECK:-false}"
ALLOW_NON_SYNOPTIC_CYCLE="${ALLOW_NON_SYNOPTIC_CYCLE:-false}"
ETL_CODE_REVISION="${ETL_CODE_REVISION:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
ETL_IMAGE_IDENTITY="${ETL_IMAGE_IDENTITY:-}"

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
      DATASET_ID="$2"
      shift 2
      ;;
    --dataset-id=*)
      DATASET_ID="${1#*=}"
      require_value "--dataset-id" "$DATASET_ID"
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
    --config-file)
      require_value "$1" "${2:-}"
      CONFIG_FILE="$2"
      shift 2
      ;;
    --config-file=*)
      CONFIG_FILE="${1#*=}"
      require_value "--config-file" "$CONFIG_FILE"
      shift
      ;;
    --source-bucket)
      require_value "$1" "${2:-}"
      SOURCE_BUCKET="$2"
      shift 2
      ;;
    --source-bucket=*)
      SOURCE_BUCKET="${1#*=}"
      require_value "--source-bucket" "$SOURCE_BUCKET"
      shift
      ;;
    --job-name-prefix)
      require_value "$1" "${2:-}"
      JOB_NAME_PREFIX="$2"
      shift 2
      ;;
    --job-name-prefix=*)
      JOB_NAME_PREFIX="${1#*=}"
      require_value "--job-name-prefix" "$JOB_NAME_PREFIX"
      shift
      ;;
    --submit-delay-seconds)
      require_value "$1" "${2:-}"
      SUBMIT_DELAY_SECONDS="$2"
      shift 2
      ;;
    --submit-delay-seconds=*)
      SUBMIT_DELAY_SECONDS="${1#*=}"
      require_value "--submit-delay-seconds" "$SUBMIT_DELAY_SECONDS"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --backfill)
      BACKFILL="true"
      shift
      ;;
    --skip-config-check)
      SKIP_CONFIG_CHECK="true"
      shift
      ;;
    --allow-non-synoptic-cycle)
      ALLOW_NON_SYNOPTIC_CYCLE="true"
      shift
      ;;
    *)
      if [[ -z "$CYCLE" && "$1" =~ ^[0-9]{10}$ ]]; then
        CYCLE="$1"
        shift
      else
        echo "Error: unexpected argument: $1" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

require_cmd aws
require_cmd md5sum
require_cmd python3
require_cmd terraform

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
  RUN_ID="$(
    python3 - <<'PY'
import secrets
from datetime import datetime, timezone
print(f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}")
PY
  )"
fi

if [[ ! "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]]; then
  echo "Error: --run-id must match YYYYMMDDTHHMMSSZ-<8 lowercase hex chars>, got: $RUN_ID" >&2
  exit 1
fi

case "$DATASET_ID" in
  gfs|icon) ;;
  *)
    echo "Error: prod manual submit supports --dataset-id gfs or --dataset-id icon; got: $DATASET_ID" >&2
    exit 1
    ;;
esac

if [[ ! "$SUBMIT_DELAY_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Error: --submit-delay-seconds must be a non-negative number." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Config file not found: $CONFIG_FILE" >&2
  exit 1
fi
if [[ ! -f "$CATALOG_FILE" ]]; then
  echo "Forecast catalog file not found: $CATALOG_FILE" >&2
  exit 1
fi

CYCLE_DATE="${CYCLE:0:8}"
CYCLE_HOUR="${CYCLE:8:2}"

if [[ "$ALLOW_NON_SYNOPTIC_CYCLE" != "true" ]]; then
  case "$CYCLE_HOUR" in
    00|06|12|18) ;;
    *)
      echo "Error: cycle hour must be one of 00, 06, 12, 18; got: $CYCLE_HOUR" >&2
      echo "Use --allow-non-synoptic-cycle to override." >&2
      exit 1
      ;;
  esac
fi

cd "$STACK_DIR"

QUEUE="$(terraform output -raw batch_job_queue_name)"
if [[ "$DATASET_ID" == "icon" ]]; then
  JOB_DEFINITION="$(terraform output -raw icon_batch_job_definition_arn)"
else
  JOB_DEFINITION="$(terraform output -raw batch_job_definition_arn)"
fi
PIPELINE_CONFIG_URI="$(terraform output -raw pipeline_config_uri)"
FORECAST_CATALOG_URI="$(terraform output -raw forecast_catalog_uri)"
ARTIFACT_ROOT_URI="s3://$(terraform output -raw artifacts_bucket_name)"
if [[ -z "$ETL_IMAGE_IDENTITY" ]]; then
  ETL_IMAGE_IDENTITY="$JOB_DEFINITION"
fi

PYTHON_BIN="${PYTHON_BIN:-$REPO_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

BACKFILL_ARGS=()
if [[ "$BACKFILL" == "true" ]]; then
  BACKFILL_ARGS+=(--backfill)
fi
set +e
BACKFILL_OUTPUT="$(
  PYTHONPATH="$REPO_ROOT/etl${PYTHONPATH:+:$PYTHONPATH}" \
    "$PYTHON_BIN" -m forecast_etl.cli check-backfill \
      --dataset-id "$DATASET_ID" \
      --cycle "$CYCLE" \
      --artifact-root-uri "$ARTIFACT_ROOT_URI" \
      "${BACKFILL_ARGS[@]}" \
      2>&1
)"
BACKFILL_STATUS=$?
set -e
if [[ "$BACKFILL_STATUS" -ne 0 ]]; then
  echo "Backfill safety check failed." >&2
  echo "$BACKFILL_OUTPUT" | sed 's/^/  /' >&2
  echo "Use --backfill only when intentionally submitting an older cycle." >&2
  exit "$BACKFILL_STATUS"
fi

if [[ "$SKIP_CONFIG_CHECK" != "true" ]]; then
  read -r CONFIG_BUCKET CONFIG_KEY < <(
    python3 - "$PIPELINE_CONFIG_URI" <<'PY'
import sys
from urllib.parse import urlparse

uri = sys.argv[1]
parsed = urlparse(uri)
if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.strip("/"):
    raise SystemExit(f"pipeline_config_uri must be s3://bucket/key, got: {uri!r}")
print(parsed.netloc, parsed.path.lstrip("/"))
PY
  )
  read -r CATALOG_BUCKET CATALOG_KEY < <(
    python3 - "$FORECAST_CATALOG_URI" <<'PY'
import sys
from urllib.parse import urlparse

uri = sys.argv[1]
parsed = urlparse(uri)
if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.strip("/"):
    raise SystemExit(f"forecast_catalog_uri must be s3://bucket/key, got: {uri!r}")
print(parsed.netloc, parsed.path.lstrip("/"))
PY
  )

  LOCAL_MD5="$(md5sum "$CONFIG_FILE" | awk '{print $1}')"
  REMOTE_ETAG="$(
    aws s3api head-object \
      --bucket "$CONFIG_BUCKET" \
      --key "$CONFIG_KEY" \
      --query ETag \
      --output text \
      | tr -d '"'
  )"

  if [[ "$REMOTE_ETAG" != "$LOCAL_MD5" ]]; then
    echo "Remote pipeline config does not match local config." >&2
    echo "  local:       $CONFIG_FILE" >&2
    echo "  s3:          $PIPELINE_CONFIG_URI" >&2
    echo "  local md5:   $LOCAL_MD5" >&2
    echo "  remote etag: $REMOTE_ETAG" >&2
    echo "Run terraform apply for this stack, or use --skip-config-check." >&2
    exit 1
  fi

  LOCAL_CATALOG_MD5="$(md5sum "$CATALOG_FILE" | awk '{print $1}')"
  REMOTE_CATALOG_ETAG="$(
    aws s3api head-object \
      --bucket "$CATALOG_BUCKET" \
      --key "$CATALOG_KEY" \
      --query ETag \
      --output text \
      | tr -d '"'
  )"

  if [[ "$REMOTE_CATALOG_ETAG" != "$LOCAL_CATALOG_MD5" ]]; then
    echo "Remote forecast catalog does not match local catalog." >&2
    echo "  local:       $CATALOG_FILE" >&2
    echo "  s3:          $FORECAST_CATALOG_URI" >&2
    echo "  local md5:   $LOCAL_CATALOG_MD5" >&2
    echo "  remote etag: $REMOTE_CATALOG_ETAG" >&2
    echo "Run terraform apply for this stack, or use --skip-config-check." >&2
    exit 1
  fi
fi

DEPLOYED_CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/weather-map-pipeline-config.XXXXXX.json")"
trap 'rm -f "$DEPLOYED_CONFIG_FILE"' EXIT
aws s3 cp "$PIPELINE_CONFIG_URI" "$DEPLOYED_CONFIG_FILE" >/dev/null

if [[ -n "$FRAMES_ARG" ]]; then
  mapfile -t FRAMES < <(
    python3 - "$FRAMES_ARG" <<'PY'
import re
import sys

raw = sys.argv[1]
parts = [part for part in re.split(r"[\s,]+", raw.strip()) if part]
if not parts:
    raise SystemExit("--frames did not contain any frames")
for index, part in enumerate(parts):
    try:
        value = int(part, 10)
    except ValueError as exc:
        raise SystemExit(f"--frames[{index}] must be an integer frame") from exc
    if value < 0 or value > 999:
        raise SystemExit(f"--frames[{index}] must be in the range 0..999")
    print(f"{value:03d}")
PY
  )
else
  mapfile -t FRAMES < <(
    python3 - "$DEPLOYED_CONFIG_FILE" "$DATASET_ID" <<'PY'
import json
import sys

config_path, dataset_id = sys.argv[1:]
with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

if not isinstance(cfg.get("datasets"), dict):
    raise SystemExit("config missing datasets")
dataset = cfg["datasets"].get(dataset_id)
if not isinstance(dataset, dict):
    raise SystemExit(f"config missing datasets.{dataset_id}")
workload = dataset.get("workload")

if not isinstance(workload, dict):
    raise SystemExit(f"config missing workload for dataset_id {dataset_id}")

if "frames" in workload:
    raw_frames = workload["frames"]
    if not isinstance(raw_frames, list) or not raw_frames:
        raise SystemExit("workload.frames must be a non-empty array")
    for index, raw in enumerate(raw_frames):
        if isinstance(raw, bool):
            raise SystemExit(f"workload.frames[{index}] must be an integer frame")
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise SystemExit(f"workload.frames[{index}] must be an integer frame") from exc
        if value < 0 or value > 999:
            raise SystemExit(f"workload.frames[{index}] must be in the range 0..999")
        print(f"{value:03d}")
else:
    if "frame_start" not in workload or "frame_end" not in workload:
        raise SystemExit("workload must specify frames or frame_start/frame_end")
    start = int(workload["frame_start"])
    end = int(workload["frame_end"])
    if start < 0 or end > 999 or end < start:
        raise SystemExit("invalid workload frame range")
    for value in range(start, end + 1):
        print(f"{value:03d}")
PY
  )
fi

if [[ "${#FRAMES[@]}" -eq 0 ]]; then
  echo "No frames resolved from config." >&2
  exit 1
fi

echo "Submitting prod ETL cycle"
echo "  stack:               $STACK_DIR"
echo "  config:              $CONFIG_FILE"
echo "  catalog:             $CATALOG_FILE"
echo "  source_config_uri:   $PIPELINE_CONFIG_URI"
echo "  source_catalog_uri:  $FORECAST_CATALOG_URI"
echo "  queue:               $QUEUE"
echo "  job_definition:      $JOB_DEFINITION"
echo "  dataset_id:          $DATASET_ID"
if [[ "$DATASET_ID" == "gfs" ]]; then
  echo "  source_bucket:       $SOURCE_BUCKET"
fi
echo "  cycle:               $CYCLE"
echo "  run_id:              $RUN_ID"
echo "  code_revision:       $ETL_CODE_REVISION"
echo "  image_identity:      $ETL_IMAGE_IDENTITY"
echo "  frames:              ${#FRAMES[@]}"
echo "  dry_run:             $DRY_RUN"
echo "  backfill:            $BACKFILL"
echo
echo "Backfill safety"
echo "$BACKFILL_OUTPUT" | sed 's/^/  /'
echo

RUN_PIPELINE_CONFIG_URI="${ARTIFACT_ROOT_URI%/}/runs/${DATASET_ID}/${CYCLE}/${RUN_ID}/config/pipeline_config.json"
RUN_FORECAST_CATALOG_URI="${ARTIFACT_ROOT_URI%/}/runs/${DATASET_ID}/${CYCLE}/${RUN_ID}/config/forecast_catalog.json"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Run snapshot"
  echo "  dry-run init-run"
  echo "  pipeline_config_uri=$RUN_PIPELINE_CONFIG_URI"
  echo "  forecast_catalog_uri=$RUN_FORECAST_CATALOG_URI"
  echo
else
  INIT_OUTPUT="$(
    PYTHONPATH="$REPO_ROOT/etl${PYTHONPATH:+:$PYTHONPATH}" \
      "$PYTHON_BIN" -m forecast_etl.cli init-run \
        --dataset-id "$DATASET_ID" \
        --cycle "$CYCLE" \
        --run-id "$RUN_ID" \
        --artifact-root-uri "$ARTIFACT_ROOT_URI" \
        --pipeline-config-uri "$PIPELINE_CONFIG_URI" \
        --forecast-catalog-uri "$FORECAST_CATALOG_URI"
  )"
  while IFS='=' read -r key value; do
    case "$key" in
      pipeline_config_uri) RUN_PIPELINE_CONFIG_URI="$value" ;;
      forecast_catalog_uri) RUN_FORECAST_CATALOG_URI="$value" ;;
    esac
  done <<< "$INIT_OUTPUT"
  if [[ -z "$RUN_PIPELINE_CONFIG_URI" || -z "$RUN_FORECAST_CATALOG_URI" ]]; then
    echo "init-run did not return snapshot config/catalog URIs." >&2
    echo "$INIT_OUTPUT" >&2
    exit 1
  fi
  echo "Run snapshot"
  echo "$INIT_OUTPUT" | sed 's/^/  /'
  echo
fi

SUBMITTED=0
for FRAME_ID in "${FRAMES[@]}"; do
  if [[ "$DATASET_ID" == "gfs" ]]; then
    SOURCE_KEY="gfs.${CYCLE_DATE}/${CYCLE_HOUR}/atmos/gfs.t${CYCLE_HOUR}z.pgrb2.0p25.f${FRAME_ID}"
    GRIB_SOURCE_URI="s3://${SOURCE_BUCKET}/${SOURCE_KEY}"
  else
    GRIB_SOURCE_URI=""
  fi
  JOB_NAME="${JOB_NAME_PREFIX}-${DATASET_ID}-${CYCLE}-${RUN_ID}-${FRAME_ID}-$(date +%s)"
  JOB_NAME="${JOB_NAME:0:128}"

  CONTAINER_OVERRIDES="$(
    python3 - "$DATASET_ID" "$CYCLE" "$RUN_ID" "$FRAME_ID" "$GRIB_SOURCE_URI" "$RUN_PIPELINE_CONFIG_URI" "$RUN_FORECAST_CATALOG_URI" "$ETL_CODE_REVISION" "$ETL_IMAGE_IDENTITY" <<'PY'
import json
import sys

dataset_id, cycle, run_id, frame_id, source_uri, pipeline_config_uri, forecast_catalog_uri, code_revision, image_identity = sys.argv[1:]
environment = [
        {"name": "DATASET_ID", "value": dataset_id},
        {"name": "CYCLE", "value": cycle},
        {"name": "RUN_ID", "value": run_id},
        {"name": "FRAME_ID", "value": frame_id},
        {"name": "PIPELINE_CONFIG_URI", "value": pipeline_config_uri},
        {"name": "FORECAST_CATALOG_URI", "value": forecast_catalog_uri},
        {"name": "ETL_CODE_REVISION", "value": code_revision},
        {"name": "ETL_IMAGE_IDENTITY", "value": image_identity},
]
if source_uri:
    environment.append({"name": "GRIB_SOURCE_URI", "value": source_uri})
print(json.dumps({"environment": environment}, separators=(",", ":")))
PY
  )"

  if [[ "$DATASET_ID" == "gfs" ]]; then
    echo "frame_id=$FRAME_ID source=$GRIB_SOURCE_URI"
  else
    echo "frame_id=$FRAME_ID source=icon-dwd"
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  dry-run job_name=$JOB_NAME"
  else
    JOB_ID="$(
      aws batch submit-job \
        --job-name "$JOB_NAME" \
        --job-queue "$QUEUE" \
        --job-definition "$JOB_DEFINITION" \
        --container-overrides "$CONTAINER_OVERRIDES" \
        --query jobId \
        --output text
    )"
    echo "  job_id=$JOB_ID"
    SUBMITTED=$((SUBMITTED + 1))
    if [[ "$SUBMIT_DELAY_SECONDS" != "0" ]]; then
      sleep "$SUBMIT_DELAY_SECONDS"
    fi
  fi
done

echo
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run complete."
else
  echo "Submitted $SUBMITTED Batch jobs."
  echo
  echo "The scheduled weather-etl-publisher Lambda will validate the run and publish manifests after all expected success markers exist."
  echo
  echo "Check recent jobs:"
  echo "  aws batch list-jobs --job-queue \"$QUEUE\" --job-status SUBMITTED"
  echo "  aws batch list-jobs --job-queue \"$QUEUE\" --job-status RUNNING"
fi
