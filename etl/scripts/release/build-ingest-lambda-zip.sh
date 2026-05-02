#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ETL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="${DIST_DIR:-$ETL_DIR/dist}"
OUTPUT_ZIP="${OUTPUT_ZIP:-$DIST_DIR/gfs-ingest-lambda.zip}"

mapfile -t FILES < <(
  cd "$ETL_DIR"
  printf '%s\n' "forecast.etl_config.json"
  find forecast_etl -type f -name '*.py' ! -path 'forecast_etl/tests/*' | sort
)

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd zip
require_cmd sha256sum

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STAGE_DIR="$TMP_DIR/stage"
TMP_ZIP="$TMP_DIR/gfs-ingest-lambda.zip"

mkdir -p "$STAGE_DIR" "$DIST_DIR"

for relpath in "${FILES[@]}"; do
  src="$ETL_DIR/$relpath"
  dst="$STAGE_DIR/$relpath"

  if [[ ! -f "$src" ]]; then
    echo "Missing required file for Lambda bundle: $src" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
done

# Normalize mtimes so repeated builds from unchanged sources produce the same zip.
find "$STAGE_DIR" -type f -exec touch -t 200001010000 {} +

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
