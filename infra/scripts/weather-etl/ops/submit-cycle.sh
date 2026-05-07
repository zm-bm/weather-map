#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
STACK_DIR="$INFRA_DIR/terraform/weather-etl"

usage() {
  cat <<'EOF'
Usage:
  infra/scripts/weather-etl/ops/submit-cycle.sh --cycle <cycle> [--model <model>]

Description:
  Submits one AWS Batch worker job per configured forecast hour for a prod ETL
  cycle. This mirrors etl/scripts/run-cycle.sh, but submits jobs to AWS Batch
  instead of running the ETL locally.

Options:
  --cycle <cycle>                 Forecast cycle string, e.g. 2026021600.
  --model <model>                 Forecast model id. Default: gfs.
  --fhours <hours>                Forecast-hour override, e.g. "000 001 006" or "000,001,006".
  --config-file <path>            Config to read. Default: infra/config/forecast.etl_config.json.
  --source-bucket <bucket>        NOAA source bucket. Default: noaa-gfs-bdp-pds.
  --job-name-prefix <prefix>      Batch job name prefix. Default: weather-etl-manual.
  --submit-delay-seconds <n>      Delay between submissions. Default: 0.
  --dry-run                       Print jobs without submitting.
  --skip-config-check             Skip local-vs-S3 config md5 check.
  --allow-non-synoptic-cycle      Allow GFS cycles outside 00/06/12/18.
  -h, --help                      Show this help and exit.

Environment defaults:
  CYCLE, MODEL, FHOURS, CONFIG_FILE, SOURCE_BUCKET, JOB_NAME_PREFIX,
  SUBMIT_DELAY_SECONDS, DRY_RUN, SKIP_CONFIG_CHECK, ALLOW_NON_SYNOPTIC_CYCLE.
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
MODEL="${MODEL:-gfs}"
FHOURS_ARG="${FHOURS:-}"
CONFIG_FILE="${CONFIG_FILE:-$INFRA_DIR/config/forecast.etl_config.json}"
SOURCE_BUCKET="${SOURCE_BUCKET:-noaa-gfs-bdp-pds}"
JOB_NAME_PREFIX="${JOB_NAME_PREFIX:-weather-etl-manual}"
SUBMIT_DELAY_SECONDS="${SUBMIT_DELAY_SECONDS:-0}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_CONFIG_CHECK="${SKIP_CONFIG_CHECK:-false}"
ALLOW_NON_SYNOPTIC_CYCLE="${ALLOW_NON_SYNOPTIC_CYCLE:-false}"

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
    --fhours)
      require_value "$1" "${2:-}"
      FHOURS_ARG="$2"
      shift 2
      ;;
    --fhours=*)
      FHOURS_ARG="${1#*=}"
      require_value "--fhours" "$FHOURS_ARG"
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

if [[ "$MODEL" != "gfs" ]]; then
  echo "Error: prod manual submit currently supports --model gfs only; got: $MODEL" >&2
  echo "ICON needs a model-specific trigger/source submitter before it can run in AWS Batch." >&2
  exit 1
fi

if [[ ! "$SUBMIT_DELAY_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Error: --submit-delay-seconds must be a non-negative number." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

CYCLE_DATE="${CYCLE:0:8}"
CYCLE_HOUR="${CYCLE:8:2}"

if [[ "$ALLOW_NON_SYNOPTIC_CYCLE" != "true" ]]; then
  case "$CYCLE_HOUR" in
    00|06|12|18) ;;
    *)
      echo "Error: GFS cycle hour must be one of 00, 06, 12, 18; got: $CYCLE_HOUR" >&2
      echo "Use --allow-non-synoptic-cycle to override." >&2
      exit 1
      ;;
  esac
fi

cd "$STACK_DIR"

QUEUE="$(terraform output -raw batch_job_queue_name)"
JOB_DEFINITION="$(terraform output -raw batch_job_definition_arn)"
PIPELINE_CONFIG_URI="$(terraform output -raw pipeline_config_uri)"

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
fi

if [[ -n "$FHOURS_ARG" ]]; then
  mapfile -t FORECAST_HOURS < <(
    python3 - "$FHOURS_ARG" <<'PY'
import re
import sys

raw = sys.argv[1]
parts = [part for part in re.split(r"[\s,]+", raw.strip()) if part]
if not parts:
    raise SystemExit("--fhours did not contain any forecast hours")
for index, part in enumerate(parts):
    try:
        value = int(part, 10)
    except ValueError as exc:
        raise SystemExit(f"--fhours[{index}] must be an integer forecast hour") from exc
    if value < 0 or value > 999:
        raise SystemExit(f"--fhours[{index}] must be in the range 0..999")
    print(f"{value:03d}")
PY
  )
else
  mapfile -t FORECAST_HOURS < <(
    python3 - "$CONFIG_FILE" "$MODEL" <<'PY'
import json
import sys

config_path, model_id = sys.argv[1:]
with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

if isinstance(cfg.get("models"), dict):
    model = cfg["models"].get(model_id)
    if not isinstance(model, dict):
        raise SystemExit(f"config missing models.{model_id}")
    workload = model.get("workload")
else:
    if model_id != "gfs":
        raise SystemExit("legacy config shape only supports model gfs")
    workload = cfg.get("workload")

if not isinstance(workload, dict):
    raise SystemExit(f"config missing workload for model {model_id}")

if "forecast_hours" in workload:
    raw_hours = workload["forecast_hours"]
    if not isinstance(raw_hours, list) or not raw_hours:
        raise SystemExit("workload.forecast_hours must be a non-empty array")
    for index, raw in enumerate(raw_hours):
        if isinstance(raw, bool):
            raise SystemExit(f"workload.forecast_hours[{index}] must be an integer forecast hour")
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise SystemExit(f"workload.forecast_hours[{index}] must be an integer forecast hour") from exc
        if value < 0 or value > 999:
            raise SystemExit(f"workload.forecast_hours[{index}] must be in the range 0..999")
        print(f"{value:03d}")
else:
    if "forecast_hour_start" not in workload or "forecast_hour_end" not in workload:
        raise SystemExit("workload must specify forecast_hours or forecast_hour_start/forecast_hour_end")
    start = int(workload["forecast_hour_start"])
    end = int(workload["forecast_hour_end"])
    if start < 0 or end > 999 or end < start:
        raise SystemExit("invalid workload forecast hour range")
    for value in range(start, end + 1):
        print(f"{value:03d}")
PY
  )
fi

if [[ "${#FORECAST_HOURS[@]}" -eq 0 ]]; then
  echo "No forecast hours resolved from config." >&2
  exit 1
fi

echo "Submitting prod ETL cycle"
echo "  stack:               $STACK_DIR"
echo "  config:              $CONFIG_FILE"
echo "  pipeline_config_uri: $PIPELINE_CONFIG_URI"
echo "  queue:               $QUEUE"
echo "  job_definition:      $JOB_DEFINITION"
echo "  model:               $MODEL"
echo "  source_bucket:       $SOURCE_BUCKET"
echo "  cycle:               $CYCLE"
echo "  forecast_hours:      ${#FORECAST_HOURS[@]}"
echo "  dry_run:             $DRY_RUN"
echo

SUBMITTED=0
for FHOUR in "${FORECAST_HOURS[@]}"; do
  SOURCE_KEY="gfs.${CYCLE_DATE}/${CYCLE_HOUR}/atmos/gfs.t${CYCLE_HOUR}z.pgrb2.0p25.f${FHOUR}"
  GRIB_SOURCE_URI="s3://${SOURCE_BUCKET}/${SOURCE_KEY}"
  JOB_NAME="${JOB_NAME_PREFIX}-${MODEL}-${CYCLE}-${FHOUR}-$(date +%s)"
  JOB_NAME="${JOB_NAME:0:128}"

  CONTAINER_OVERRIDES="$(
    python3 - "$MODEL" "$CYCLE" "$FHOUR" "$GRIB_SOURCE_URI" "$PIPELINE_CONFIG_URI" <<'PY'
import json
import sys

model, cycle, fhour, source_uri, pipeline_config_uri = sys.argv[1:]
print(json.dumps({
    "environment": [
        {"name": "MODEL", "value": model},
        {"name": "CYCLE", "value": cycle},
        {"name": "FHOUR", "value": fhour},
        {"name": "GRIB_SOURCE_URI", "value": source_uri},
        {"name": "PIPELINE_CONFIG_URI", "value": pipeline_config_uri},
    ]
}, separators=(",", ":")))
PY
  )"

  echo "fhour=$FHOUR source=$GRIB_SOURCE_URI"
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
  echo "Check recent jobs:"
  echo "  aws batch list-jobs --job-queue \"$QUEUE\" --job-status SUBMITTED"
  echo "  aws batch list-jobs --job-queue \"$QUEUE\" --job-status RUNNING"
fi
