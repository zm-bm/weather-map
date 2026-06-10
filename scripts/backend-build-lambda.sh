#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$REPO_ROOT/backend/dist"
BUILD_DIR="$REPO_ROOT/backend/.lambda-build"
ZIP_PATH="$DIST_DIR/weather-map-backend-lambda.zip"

PYTHON_BIN="${PYTHON_BIN:-python3.12}"

cleanup_source_build_artifacts() {
  rm -rf "$REPO_ROOT/backend/build"
}

trap cleanup_source_build_artifacts EXIT

rm -rf "$BUILD_DIR"
cleanup_source_build_artifacts
mkdir -p "$BUILD_DIR/package" "$DIST_DIR"

"$PYTHON_BIN" -m pip install --no-cache-dir --upgrade --target "$BUILD_DIR/package" \
  "$REPO_ROOT/backend"

(
  cd "$BUILD_DIR/package"
  find . -name '*.pyc' -delete
  find . -type d -name '__pycache__' -prune -exec rm -rf {} +
  zip -qr "$ZIP_PATH" .
)

echo "Wrote $ZIP_PATH"
