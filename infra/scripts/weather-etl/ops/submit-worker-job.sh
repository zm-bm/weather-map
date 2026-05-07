#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
STACK_DIR="$INFRA_DIR/terraform/weather-etl"
cd "$STACK_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd terraform
require_cmd aws

QUEUE="$(terraform output -raw batch_job_queue_name)"
JOB_DEFINITION="$(terraform output -raw batch_job_definition_arn)"

JOB_NAME_PREFIX="${JOB_NAME_PREFIX:-weather-etl-worker}"
JOB_NAME="${JOB_NAME_PREFIX}-$(date +%s)"

MODEL="${MODEL:-gfs}"
CYCLE="${CYCLE:?CYCLE is required}"
FHOUR="${FHOUR:?FHOUR is required}"
GRIB_SOURCE_URI="${GRIB_SOURCE_URI:?GRIB_SOURCE_URI is required}"

echo "Submitting worker job"
echo "  queue: $QUEUE"
echo "  job_definition: $JOB_DEFINITION"
echo "  model: $MODEL"
echo "  cycle/fhour: $CYCLE / $FHOUR"
echo "  grib_source_uri: $GRIB_SOURCE_URI"

CONTAINER_OVERRIDES="$(cat <<EOF
{
  "environment": [
    {"name": "MODEL", "value": "$MODEL"},
    {"name": "CYCLE", "value": "$CYCLE"},
    {"name": "FHOUR", "value": "$FHOUR"},
    {"name": "GRIB_SOURCE_URI", "value": "$GRIB_SOURCE_URI"}
  ]
}
EOF
)"

JOB_ID="$(aws batch submit-job \
  --job-name "$JOB_NAME" \
  --job-queue "$QUEUE" \
  --job-definition "$JOB_DEFINITION" \
  --container-overrides "$CONTAINER_OVERRIDES" \
  --query jobId --output text)"

echo
echo "Submitted."
echo "  job_name: $JOB_NAME"
echo "  job_id:   $JOB_ID"
echo
echo "Check status:"
echo "  aws batch describe-jobs --jobs $JOB_ID --query 'jobs[0].status' --output text"
echo
echo "Find log stream:"
echo "  aws batch describe-jobs --jobs $JOB_ID --query 'jobs[0].container.logStreamName' --output text"
echo
echo "Read logs:"
echo "  aws logs get-log-events --log-group-name /aws/batch/weather-etl --log-stream-name <LOG_STREAM> --limit 100 --query events[].message --output text"
