#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${TERRAFORM_DIR:-/home/rick/code/infra/stacks/weather-etl}"
cd "$TERRAFORM_DIR"

FN_NAME="$(terraform output -raw ingest_lambda_name)"
PAYLOAD_FILE="${PAYLOAD_FILE:-$SCRIPT_DIR/events/sns-test-event.json}"
OUT_FILE="${OUT_FILE:-$SCRIPT_DIR/events/invoke-output.json}"

echo "Invoking lambda: $FN_NAME"
echo "Payload: $PAYLOAD_FILE"
echo "Terraform dir: $TERRAFORM_DIR"

aws lambda invoke \
  --function-name "$FN_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload "$(cat "$PAYLOAD_FILE")" \
  "$OUT_FILE" \
  --query 'StatusCode' --output text

echo "Lambda response payload:"
cat "$OUT_FILE"

echo
echo "Recent logs:"
aws logs tail "/aws/lambda/$FN_NAME" --since 10m
