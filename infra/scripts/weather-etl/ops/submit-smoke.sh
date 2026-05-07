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

JOB_NAME_PREFIX="${JOB_NAME_PREFIX:-weather-etl-smoke}"
JOB_NAME="${JOB_NAME_PREFIX}-$(date +%s)"

echo "Submitting smoke job"
echo "  queue: $QUEUE"
echo "  job_definition: $JOB_DEFINITION"
echo "  mode: cli smoke"

JOB_ID="$(aws batch submit-job \
  --job-name "$JOB_NAME" \
  --job-queue "$QUEUE" \
  --job-definition "$JOB_DEFINITION" \
  --container-overrides '{"command": ["smoke"]}' \
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
