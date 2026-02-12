#!/bin/bash
set -euo pipefail

# Ensure new files are world-readable (dirs 755, files 644) for nginx.
umask 022

# Required: where tiles/manifests are pulled from. Supports:
# - s3://bucket/prefix
# - local directory containing manifests/ and tiles/
ARTIFACT_SOURCE="${ARTIFACT_SOURCE:?ARTIFACT_SOURCE is required}"

# When true, triggers a restart so Martin picks up new MBTiles.
RESTART_ENABLED="${RESTART_ENABLED:-true}"

# When true, remove MBTiles from previous cycles after a successful sync.
PRUNE_OLD_TILES="${PRUNE_OLD_TILES:-true}"

# NOTE: Updates are not atomic. For safer swaps, sync into a staging dir and
#       atomically move or retarget a symlink (e.g., tiles/current -> tiles/$cycle).
# NOTE: Concurrent runs are not guarded. Consider adding a lock (flock or
#       systemd ExecStartPre=/usr/bin/flock ...) to prevent overlap.

# Base directory that contains: tiles/, manifests/, static/, public/
TILESERVER_DIR="${TILESERVER_DIR:-/opt/weather-map/tileserver}"
PUBLIC_MANIFEST_DIR="${TILESERVER_DIR}/public/manifests"
MANIFEST_DIR="${TILESERVER_DIR}/manifests"
DEST_DIR="${TILESERVER_DIR}/tiles"
STATIC_DIR="${TILESERVER_DIR}/static"

# Determine source type and validate local path if needed.
if [[ "$ARTIFACT_SOURCE" == s3://* ]]; then
  ARTIFACT_MODE="s3"
else
  ARTIFACT_MODE="local"
  if [[ ! -d "$ARTIFACT_SOURCE" ]]; then
    echo "Local ARTIFACT_SOURCE not found: $ARTIFACT_SOURCE" >&2
    exit 1
  fi
fi

# Ensure target directories exist before syncing.
mkdir -p "$DEST_DIR" "$MANIFEST_DIR" "$STATIC_DIR" "$PUBLIC_MANIFEST_DIR"

ARTIFACT_MANIFESTS_DIR="${ARTIFACT_SOURCE}/manifests"
ARTIFACT_TILES_DIR="${ARTIFACT_SOURCE}/tiles"
ARTIFACT_LATEST_JSON="${ARTIFACT_MANIFESTS_DIR}/latest.json"

PUBLIC_LATEST_JSON="${PUBLIC_MANIFEST_DIR}/latest.json"

# Download (or copy) the latest manifest to a temp file for comparison.
TMP_LATEST="$(mktemp)"
trap 'rm -f "$TMP_LATEST"' EXIT

if [[ "$ARTIFACT_MODE" == "s3" ]]; then
  aws s3 cp "$ARTIFACT_LATEST_JSON" "$TMP_LATEST" --only-show-errors
else
  cp "$ARTIFACT_LATEST_JSON" "$TMP_LATEST"
fi

if [[ ! -f "$PUBLIC_LATEST_JSON" ]] || ! cmp -s "$TMP_LATEST" "$PUBLIC_LATEST_JSON"; then
  # New cycle detected: fetch manifest + tiles for that cycle.
  cycle=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cycle"])' "$TMP_LATEST")

  ARTIFACT_CYCLE_JSON="${ARTIFACT_MANIFESTS_DIR}/${cycle}.json"
  MANIFEST_CYCLE_JSON="${MANIFEST_DIR}/${cycle}.json"
  PUBLIC_CYCLE_JSON="${PUBLIC_MANIFEST_DIR}/${cycle}.json"
  TILE_INCLUDE_PATTERN="${cycle}.*.mbtiles"

  if [[ "$ARTIFACT_MODE" == "s3" ]]; then
    aws s3 cp "$ARTIFACT_CYCLE_JSON" "$MANIFEST_CYCLE_JSON" --only-show-errors
    aws s3 sync "${ARTIFACT_TILES_DIR}/" "$DEST_DIR" --exclude "*" --include "$TILE_INCLUDE_PATTERN" --only-show-errors
  else
    cp "$ARTIFACT_CYCLE_JSON" "$MANIFEST_CYCLE_JSON"
    shopt -s nullglob
    for tile in "$ARTIFACT_TILES_DIR/$cycle".*.mbtiles; do
      cp -f "$tile" "$DEST_DIR/"
    done
    shopt -u nullglob
  fi

  # Promote latest.json and cycle manifest to the public directory.
  mv "$TMP_LATEST" "$PUBLIC_LATEST_JSON"
  cp "$MANIFEST_CYCLE_JSON" "$PUBLIC_CYCLE_JSON"
  # Ensure nginx can read the public manifests.
  chmod 644 "$PUBLIC_LATEST_JSON" "$PUBLIC_CYCLE_JSON"

  if [[ "$PRUNE_OLD_TILES" == "true" ]]; then
    # Remove any mbtiles not matching the current cycle prefix.
    shopt -s nullglob
    for tile in "$DEST_DIR"/*.mbtiles; do
      if [[ "${tile##*/}" != "${cycle}."* ]]; then
        rm -f "$tile"
      fi
    done
    shopt -u nullglob
  fi

  if [[ "$RESTART_ENABLED" == "true" ]]; then
    systemctl restart weather-map-compose
  fi
fi
