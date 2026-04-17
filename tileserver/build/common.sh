#!/usr/bin/env bash

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TILESERVER_DIR="$(cd -- "${SELF_DIR}/.." && pwd)"
DATA_DIR="${TILESERVER_DIR}/data"
STATIC_DIR="${TILESERVER_DIR}/static"
VERSION="1"

log() {
  printf '==> %s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

run() {
  printf '+ ' >&2
  printf '%q ' "$@" >&2
  printf '\n' >&2
  "$@" 1>&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || die "File not found: $path"
}

validate_bbox() {
  local bbox="$1"
  [[ "$bbox" =~ ^-?[0-9]+([.][0-9]+)?,-?[0-9]+([.][0-9]+)?,-?[0-9]+([.][0-9]+)?,-?[0-9]+([.][0-9]+)?$ ]] \
    || die "Invalid --bbox value: $bbox"
}

validate_zoom_arg() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[0-9]+$ ]] || die "Invalid ${name} value: $value"
  (( value >= 0 && value <= 14 )) || die "${name} must be between 0 and 14: $value"
}

metadata_upsert() {
  local mbtiles="$1"
  local name="$2"
  local value="$3"
  local escaped

  escaped="$(printf "%s" "$value" | sed "s/'/''/g")"
  run sqlite3 "$mbtiles" "DELETE FROM metadata WHERE name = '$name'; INSERT INTO metadata(name, value) VALUES ('$name', '$escaped');"
}

ensure_vector_layer() {
  local mbtiles="$1"
  local layer_id="$2"
  local count

  count="$(sqlite3 "$mbtiles" "select count(*) from metadata where name = 'json' and value like '%\"id\":\"${layer_id}\"%';")"
  [[ "$count" == "1" ]] || die "MBTiles does not advertise layer '${layer_id}': $mbtiles"
}
