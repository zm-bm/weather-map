#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ETL_DIR="$REPO_ROOT/etl"
DIST_DIR="${DIST_DIR:-$ETL_DIR/dist}"
OUTPUT_ZIP="${OUTPUT_ZIP:-$DIST_DIR/gfs-ingest-lambda.zip}"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"
LAMBDA_PYTHON_VERSION="3.12"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd zip
require_cmd sha256sum
require_cmd "$PYTHON_BIN"

PYTHON_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$PYTHON_VERSION" != "$LAMBDA_PYTHON_VERSION" ]]; then
  echo "Python $LAMBDA_PYTHON_VERSION is required to build this Lambda artifact; got $PYTHON_VERSION from $PYTHON_BIN" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STAGE_DIR="$TMP_DIR/stage"
TMP_ZIP="$TMP_DIR/gfs-ingest-lambda.zip"
BUILD_VENV="$TMP_DIR/venv"
BUILD_PYTHON="$BUILD_VENV/bin/python"
BUILD_SRC="$TMP_DIR/src"

mkdir -p "$STAGE_DIR" "$DIST_DIR" "$BUILD_SRC"

if [[ ! -f "$ETL_DIR/forecast.etl_config.json" ]]; then
  echo "Missing required file for Lambda bundle: $ETL_DIR/forecast.etl_config.json" >&2
  exit 1
fi

PYTHONDONTWRITEBYTECODE=1 "$PYTHON_BIN" -m venv "$BUILD_VENV"

cp "$ETL_DIR/pyproject.toml" "$BUILD_SRC/pyproject.toml"
cp -R "$ETL_DIR/forecast_etl" "$BUILD_SRC/forecast_etl"

PYTHONDONTWRITEBYTECODE=1 "$BUILD_PYTHON" -m pip --isolated install \
  --disable-pip-version-check \
  --no-cache-dir \
  "setuptools>=64" >/dev/null

PYTHONDONTWRITEBYTECODE=1 "$BUILD_PYTHON" -m pip --isolated install \
  --disable-pip-version-check \
  --ignore-installed \
  --no-cache-dir \
  --no-compile \
  --no-build-isolation \
  --target "$STAGE_DIR" \
  "$BUILD_SRC" >/dev/null

cp "$ETL_DIR/forecast.etl_config.json" "$STAGE_DIR/forecast.etl_config.json"

find "$STAGE_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$STAGE_DIR" -type f -name '*.pyc' -delete
rm -rf "$STAGE_DIR/bin" "$STAGE_DIR/forecast_etl/tests"

# Normalize mtimes so repeated builds from unchanged sources produce the same zip.
find "$STAGE_DIR" -type f -exec touch -t 200001010000 {} +

mapfile -t FILES < <(
  cd "$STAGE_DIR"
  find . -type f | sed 's#^\./##' | LC_ALL=C sort
)

(
  cd "$STAGE_DIR"
  zip -X -q "$TMP_ZIP" "${FILES[@]}"
)

if [[ -f "$OUTPUT_ZIP" ]] && cmp -s "$TMP_ZIP" "$OUTPUT_ZIP"; then
  SHA256="$(sha256sum "$OUTPUT_ZIP" | awk '{print $1}')"
  echo "Lambda artifact already up to date: $OUTPUT_ZIP"
  echo "sha256: $SHA256"
  exit 0
fi

mv "$TMP_ZIP" "$OUTPUT_ZIP"
SHA256="$(sha256sum "$OUTPUT_ZIP" | awk '{print $1}')"

echo "Wrote Lambda artifact: $OUTPUT_ZIP"
echo "sha256: $SHA256"
