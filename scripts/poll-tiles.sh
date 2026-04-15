#!/bin/bash
set -euo pipefail

# Ensure new files are world-readable (dirs 755, files 644) for nginx.
umask 022

# Required: where artifacts are pulled from. Supports:
# - s3://bucket/prefix
# - local directory containing manifests/ and fields/
ARTIFACT_SOURCE="${ARTIFACT_SOURCE:?ARTIFACT_SOURCE is required}"

# When true, triggers a restart after successful sync.
RESTART_ENABLED="${RESTART_ENABLED:-true}"

# When true, remove stale forecast-cycle artifacts after successful sync.
PRUNE_OLD_TILES="${PRUNE_OLD_TILES:-true}"

# Base directory that contains: tiles/, static/, and public/
TILESERVER_DIR="${TILESERVER_DIR:-/opt/weather-map/tileserver}"
PUBLIC_MANIFEST_DIR="${TILESERVER_DIR}/public/manifests"
PUBLIC_FIELDS_DIR="${TILESERVER_DIR}/public/fields"
DEST_DIR="${TILESERVER_DIR}/tiles"
STATIC_DIR="${TILESERVER_DIR}/static"

if [[ "$ARTIFACT_SOURCE" == s3://* ]]; then
  ARTIFACT_MODE="s3"
else
  ARTIFACT_MODE="local"
  if [[ ! -d "$ARTIFACT_SOURCE" ]]; then
    echo "Local ARTIFACT_SOURCE not found: $ARTIFACT_SOURCE" >&2
    exit 1
  fi
fi

mkdir -p "$DEST_DIR" "$STATIC_DIR" "$PUBLIC_MANIFEST_DIR" "$PUBLIC_FIELDS_DIR"

ARTIFACT_MANIFESTS_DIR="${ARTIFACT_SOURCE}/manifests"
ARTIFACT_FIELDS_DIR="${ARTIFACT_SOURCE}/fields"
ARTIFACT_LATEST_JSON="${ARTIFACT_MANIFESTS_DIR}/latest.json"

PUBLIC_LATEST_JSON="${PUBLIC_MANIFEST_DIR}/latest.json"

TMP_LATEST="$(mktemp)"
trap 'rm -f "$TMP_LATEST"' EXIT

if [[ "$ARTIFACT_MODE" == "s3" ]]; then
  aws s3 cp "$ARTIFACT_LATEST_JSON" "$TMP_LATEST" --only-show-errors
else
  cp "$ARTIFACT_LATEST_JSON" "$TMP_LATEST"
fi

cycle=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cycle"])' "$TMP_LATEST")

update_required="false"
if [[ ! -f "$PUBLIC_LATEST_JSON" ]] || ! cmp -s "$TMP_LATEST" "$PUBLIC_LATEST_JSON"; then
  update_required="true"
fi

# If latest cycle pointer is unchanged but cycle payloads are missing locally,
# force a refresh to heal partial or failed prior syncs.
if [[ "$update_required" == "false" ]]; then
  if [[ ! -d "${PUBLIC_FIELDS_DIR}/${cycle}" ]] || ! find "${PUBLIC_FIELDS_DIR}/${cycle}" -type f -name "*.bin" -print -quit | grep -q .; then
    update_required="true"
  fi
fi

if [[ "$update_required" == "true" ]]; then
  ARTIFACT_CYCLE_JSON="${ARTIFACT_MANIFESTS_DIR}/${cycle}.json"
  PUBLIC_CYCLE_JSON="${PUBLIC_MANIFEST_DIR}/${cycle}.json"

  if [[ "$ARTIFACT_MODE" == "s3" ]]; then
    aws s3 cp "$ARTIFACT_CYCLE_JSON" "$PUBLIC_CYCLE_JSON" --only-show-errors
    if aws s3 ls "${ARTIFACT_FIELDS_DIR}/${cycle}/" >/dev/null 2>&1; then
      mkdir -p "${PUBLIC_FIELDS_DIR}/${cycle}"
      aws s3 sync "${ARTIFACT_FIELDS_DIR}/${cycle}/" "${PUBLIC_FIELDS_DIR}/${cycle}/" \
        --exclude "*" \
        --include "*.scalar.i16.bin" \
        --include "*.vector.i8.bin" \
        --only-show-errors
    fi
  else
    cp "$ARTIFACT_CYCLE_JSON" "$PUBLIC_CYCLE_JSON"
    if [[ -d "${ARTIFACT_FIELDS_DIR}/${cycle}" ]]; then
      while IFS= read -r src; do
        rel="${src#${ARTIFACT_FIELDS_DIR}/${cycle}/}"
        dst="${PUBLIC_FIELDS_DIR}/${cycle}/${rel}"
        mkdir -p "$(dirname "$dst")"
        cp -f "$src" "$dst"
      done < <(find "${ARTIFACT_FIELDS_DIR}/${cycle}" -type f \( -name "*.scalar.i16.bin" -o -name "*.vector.i8.bin" \))
    fi
  fi

  mv "$TMP_LATEST" "$PUBLIC_LATEST_JSON"
  chmod 644 "$PUBLIC_LATEST_JSON" "$PUBLIC_CYCLE_JSON"

  if [[ "$PRUNE_OLD_TILES" == "true" ]]; then
    shopt -s nullglob

    # Remove forecast weather MBTiles from the deprecated raster path.
    for tile in "$DEST_DIR"/*.mbtiles; do
      base="${tile##*/}"
      if [[ "$base" =~ ^[0-9]{10}\..*\.mbtiles$ ]]; then
        rm -f "$tile"
      fi
    done

    # Keep only current-cycle fields directory.
    for fields_dir in "$PUBLIC_FIELDS_DIR"/*; do
      if [[ -d "$fields_dir" && "${fields_dir##*/}" != "${cycle}" ]]; then
        rm -rf "$fields_dir"
      fi
    done

    # Remove stale cycle manifests and legacy .v2 manifests.
    for manifest in "$PUBLIC_MANIFEST_DIR"/*.json; do
      base="${manifest##*/}"
      if [[ "$base" == "latest.v2.json" ]]; then
        rm -f "$manifest"
        continue
      fi
      if [[ "$base" =~ ^[0-9]{10}\.v2\.json$ ]]; then
        rm -f "$manifest"
        continue
      fi
      if [[ "$base" =~ ^[0-9]{10}\.json$ && "$base" != "${cycle}.json" ]]; then
        rm -f "$manifest"
      fi
    done

    shopt -u nullglob
  fi

  if [[ "$RESTART_ENABLED" == "true" ]]; then
    systemctl restart weather-map-compose
  fi
fi
