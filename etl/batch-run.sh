#!/usr/bin/env bash
set -euo pipefail

if [[ "${SMOKE_TEST:-false}" == "true" ]]; then
  echo "hello world"
  exit 0
fi

# Batch runtime inputs (passed via Batch container overrides).
CYCLE="${CYCLE:?CYCLE is required}"
FHOUR="${FHOUR:?FHOUR is required}"
GRIB_SOURCE_URI="${GRIB_SOURCE_URI:?GRIB_SOURCE_URI is required}"

# These are already provided by the Batch job definition defaults.
ARTIFACT_ROOT_URI="${ARTIFACT_ROOT_URI:?ARTIFACT_ROOT_URI is required}"
PIPELINE_CONFIG_URI="${PIPELINE_CONFIG_URI:?PIPELINE_CONFIG_URI is required}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

LOCAL_GRIB_PATH="$WORKDIR/input.grib2"

echo "[batch-run] start cycle=${CYCLE} fhour=${FHOUR}"
echo "[batch-run] grib_source_uri=${GRIB_SOURCE_URI}"

if [[ "$GRIB_SOURCE_URI" == s3://* ]]; then
  echo "[batch-run] downloading GRIB from S3"
  NOAA_NO_SIGN_REQUEST="${NOAA_NO_SIGN_REQUEST:-true}"
  if [[ "$NOAA_NO_SIGN_REQUEST" == "true" ]]; then
    aws s3 cp "$GRIB_SOURCE_URI" "$LOCAL_GRIB_PATH" --only-show-errors --no-sign-request
  else
    aws s3 cp "$GRIB_SOURCE_URI" "$LOCAL_GRIB_PATH" --only-show-errors
  fi
elif [[ "$GRIB_SOURCE_URI" == http://* || "$GRIB_SOURCE_URI" == https://* ]]; then
  echo "[batch-run] downloading GRIB from HTTP(S)"
  curl -fsSL "$GRIB_SOURCE_URI" -o "$LOCAL_GRIB_PATH"
elif [[ "$GRIB_SOURCE_URI" == file://* ]]; then
  echo "[batch-run] using file:// GRIB"
  cp "${GRIB_SOURCE_URI#file://}" "$LOCAL_GRIB_PATH"
else
  echo "[batch-run] unsupported GRIB_SOURCE_URI scheme: $GRIB_SOURCE_URI" >&2
  exit 1
fi

LOCAL_SOURCE_URI="file://${LOCAL_GRIB_PATH}"

echo "[batch-run] process-hour"
python -u -m gfs_pipeline.cli process-hour \
  --cycle "$CYCLE" \
  --fhour "$FHOUR" \
  --source-uri "$LOCAL_SOURCE_URI" \
  --artifact-root-uri "$ARTIFACT_ROOT_URI" \
  --pipeline-config-uri "$PIPELINE_CONFIG_URI"

echo "[batch-run] publish"
python -u -m gfs_pipeline.cli publish \
  --cycle "$CYCLE" \
  --artifact-root-uri "$ARTIFACT_ROOT_URI" \
  --pipeline-config-uri "$PIPELINE_CONFIG_URI"

echo "[batch-run] done"
