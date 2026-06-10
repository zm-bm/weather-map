#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/infra"
STACK_DIR="$INFRA_DIR/terraform/weather-etl"

usage() {
  cat <<'EOF'
Usage:
  etl/scripts/run-cycle-aws.sh --cycle <cycle> [--run-id <run_id>] [--dataset-id <dataset_id>]

Description:
  Submits one AWS Batch worker job per resumable frame. This does not validate
  or publish the cycle; the scheduled weather-etl-publisher Lambda handles
  validation, manifest publication, and status refresh after workers complete.

Options:
  --cycle <cycle>                 Cycle string, e.g. 2026021600.
  --run-id <run_id>               Run id for this cycle attempt. Default: generated.
  --dataset-id <dataset_id>       Dataset id. Default: gfs.
  --frames <frames>               Frame override, e.g. "000 001 006" or "000,001,006".
  --artifact <id>                 Artifact id to process; repeat to process multiple artifacts.
  --config-file <path>            Config to compare with deployed config. Default: config/pipeline.json.
  --catalog-file <path>           Catalog to compare with deployed catalog. Default: config/catalog.json.
  --source-bucket <bucket>        NOAA GFS source bucket. Default: noaa-gfs-bdp-pds.
  --job-name-prefix <prefix>      Batch job name prefix. Default: weather-etl-manual.
  --submit-delay-seconds <n>      Delay between submissions. Default: 0.
  --dry-run                       Print jobs without submitting or claiming.
  --force-backfill                Force submitting a cycle older than current latest.
  --skip-config-check             Skip local-vs-S3 config/catalog md5 checks.
  --allow-non-synoptic-cycle      Allow cycles outside 00/06/12/18.
  -h, --help                      Show this help and exit.

Environment defaults:
  CYCLE, RUN_ID, DATASET_ID, FRAMES, CONFIG_FILE, CATALOG_FILE, SOURCE_BUCKET,
  JOB_NAME_PREFIX, SUBMIT_DELAY_SECONDS, DRY_RUN, FORCE_BACKFILL, SKIP_CONFIG_CHECK,
  ALLOW_NON_SYNOPTIC_CYCLE, ETL_CODE_REVISION, ETL_IMAGE_IDENTITY.
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
SELECTED_ARTIFACTS=()
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/config/pipeline.json}"
CATALOG_FILE="${CATALOG_FILE:-$REPO_ROOT/config/catalog.json}"
SOURCE_BUCKET="${SOURCE_BUCKET:-noaa-gfs-bdp-pds}"
JOB_NAME_PREFIX="${JOB_NAME_PREFIX:-weather-etl-manual}"
SUBMIT_DELAY_SECONDS="${SUBMIT_DELAY_SECONDS:-0}"
DRY_RUN="${DRY_RUN:-false}"
FORCE_BACKFILL="${FORCE_BACKFILL:-false}"
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
    --catalog-file)
      require_value "$1" "${2:-}"
      CATALOG_FILE="$2"
      shift 2
      ;;
    --catalog-file=*)
      CATALOG_FILE="${1#*=}"
      require_value "--catalog-file" "$CATALOG_FILE"
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
    --force-backfill)
      FORCE_BACKFILL="true"
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
      echo "Error: unexpected argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd terraform
require_cmd aws

if [[ -z "$CYCLE" ]]; then
  echo "Error: --cycle <cycle> is required." >&2
  usage >&2
  exit 1
fi
if [[ ! "$CYCLE" =~ ^[0-9]{10}$ ]]; then
  echo "Error: --cycle must be YYYYMMDDHH, got: $CYCLE" >&2
  exit 1
fi
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

case "$DATASET_ID" in
  gfs|icon) ;;
  *)
    echo "Error: prod manual submit supports --dataset-id gfs or --dataset-id icon; got: $DATASET_ID" >&2
    exit 1
    ;;
esac

cd "$STACK_DIR"
QUEUE="$(terraform output -raw batch_job_queue_name)"
if [[ "$DATASET_ID" == "icon" ]]; then
  JOB_DEFINITION="$(terraform output -raw icon_batch_job_definition_arn)"
else
  JOB_DEFINITION="$(terraform output -raw batch_job_definition_arn)"
fi
PIPELINE_URI="$(terraform output -raw pipeline_uri)"
CATALOG_URI="$(terraform output -raw catalog_uri)"
ARTIFACT_ROOT_URI="$(terraform output -raw artifact_root_uri)"
FRAME_CLAIM_TABLE="$(terraform output -raw frame_claim_table_name)"

if [[ -z "$ETL_IMAGE_IDENTITY" ]]; then
  ETL_IMAGE_IDENTITY="$JOB_DEFINITION"
fi

PYTHON_BIN="${PYTHON_BIN:-$REPO_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

parse_s3_uri() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse
uri = sys.argv[1]
parsed = urlparse(uri)
if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.strip("/"):
    raise SystemExit(f"expected s3://bucket/key, got: {uri!r}")
print(parsed.netloc, parsed.path.lstrip("/"))
PY
}

if [[ "$SKIP_CONFIG_CHECK" != "true" ]]; then
  read -r CONFIG_BUCKET CONFIG_KEY < <(parse_s3_uri "$PIPELINE_URI")
  read -r CATALOG_BUCKET CATALOG_KEY < <(parse_s3_uri "$CATALOG_URI")
  LOCAL_MD5="$(md5sum "$CONFIG_FILE" | awk '{print $1}')"
  REMOTE_ETAG="$(aws s3api head-object --bucket "$CONFIG_BUCKET" --key "$CONFIG_KEY" --query ETag --output text | tr -d '"')"
  if [[ "$REMOTE_ETAG" != "$LOCAL_MD5" ]]; then
    echo "Remote pipeline config does not match local config." >&2
    echo "Run terraform apply for this stack, or use --skip-config-check." >&2
    exit 1
  fi
  LOCAL_CATALOG_MD5="$(md5sum "$CATALOG_FILE" | awk '{print $1}')"
  REMOTE_CATALOG_ETAG="$(aws s3api head-object --bucket "$CATALOG_BUCKET" --key "$CATALOG_KEY" --query ETag --output text | tr -d '"')"
  if [[ "$REMOTE_CATALOG_ETAG" != "$LOCAL_CATALOG_MD5" ]]; then
    echo "Remote catalog does not match local catalog." >&2
    echo "Run terraform apply for this stack, or use --skip-config-check." >&2
    exit 1
  fi
fi

cmd=(
  "$PYTHON_BIN" -m weather_etl submit-aws-cycle
  --dataset-id "$DATASET_ID"
  --cycle "$CYCLE"
  --artifact-root-uri "$ARTIFACT_ROOT_URI"
  --pipeline-uri "$PIPELINE_URI"
  --catalog-uri "$CATALOG_URI"
  --job-queue "$QUEUE"
  --job-definition "$JOB_DEFINITION"
  --frame-claim-table "$FRAME_CLAIM_TABLE"
  --source-bucket "$SOURCE_BUCKET"
  --job-name-prefix "$JOB_NAME_PREFIX"
  --submit-delay-seconds "$SUBMIT_DELAY_SECONDS"
)
if [[ -n "$RUN_ID" ]]; then
  cmd+=(--run-id "$RUN_ID")
fi
if [[ -n "$FRAMES_ARG" ]]; then
  cmd+=(--frames "$FRAMES_ARG")
fi
if [[ "$DRY_RUN" == "true" ]]; then
  cmd+=(--dry-run)
fi
if [[ "$FORCE_BACKFILL" == "true" ]]; then
  cmd+=(--force-backfill)
fi
for artifact in "${SELECTED_ARTIFACTS[@]}"; do
  cmd+=(--artifact "$artifact")
done

echo "Submitting prod ETL cycle"
echo "  stack:               $STACK_DIR"
echo "  source_pipeline_uri: $PIPELINE_URI"
echo "  source_catalog_uri:  $CATALOG_URI"
echo "  artifact_root_uri:   $ARTIFACT_ROOT_URI"
echo "  frame_claim_table:   $FRAME_CLAIM_TABLE"
echo "  queue:               $QUEUE"
echo "  job_definition:      $JOB_DEFINITION"
echo "  dataset_id:          $DATASET_ID"
echo "  cycle:               $CYCLE"
echo "  run_id:              ${RUN_ID:-generated}"
echo "  dry_run:             $DRY_RUN"
echo "  force_backfill:      $FORCE_BACKFILL"
echo

PYTHONPATH="$REPO_ROOT/etl${PYTHONPATH:+:$PYTHONPATH}" \
ETL_CODE_REVISION="$ETL_CODE_REVISION" \
ETL_IMAGE_IDENTITY="$ETL_IMAGE_IDENTITY" \
  "${cmd[@]}"
