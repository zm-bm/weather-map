#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

STACK_DIR="${STACK_DIR:-$REPO_ROOT/infra/weather-etl}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$REPO_ROOT/artifacts}"
ARTIFACTS_BUCKET="${ARTIFACTS_BUCKET:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DRY_RUN="${DRY_RUN:-false}"
ALLOW_EMPTY="${ALLOW_EMPTY:-false}"

DEFAULT_RADIO_PLAYLIST_CACHE_CONTROL="public, max-age=60, s-maxage=300, stale-while-revalidate=60"
DEFAULT_RADIO_AUDIO_CACHE_CONTROL="public, max-age=86400, s-maxage=604800"

GLYPH_CACHE_CONTROL="${GLYPH_CACHE_CONTROL:-public, max-age=604800, s-maxage=2592000}"
PMTILES_CACHE_CONTROL="${PMTILES_CACHE_CONTROL:-public, max-age=86400, s-maxage=604800}"
RADIO_CACHE_CONTROL="${RADIO_CACHE_CONTROL:-}"
RADIO_PLAYLIST_CACHE_CONTROL="${RADIO_PLAYLIST_CACHE_CONTROL:-}"
RADIO_AUDIO_CACHE_CONTROL="${RADIO_AUDIO_CACHE_CONTROL:-}"

if [[ -z "$RADIO_PLAYLIST_CACHE_CONTROL" ]]; then
  RADIO_PLAYLIST_CACHE_CONTROL="${RADIO_CACHE_CONTROL:-$DEFAULT_RADIO_PLAYLIST_CACHE_CONTROL}"
fi

if [[ -z "$RADIO_AUDIO_CACHE_CONTROL" ]]; then
  RADIO_AUDIO_CACHE_CONTROL="${RADIO_CACHE_CONTROL:-$DEFAULT_RADIO_AUDIO_CACHE_CONTROL}"
fi

usage() {
  cat <<'EOF'
Usage:
  scripts/etl-upload-static-artifacts.sh [options]

Description:
  Uploads repo-local static artifacts to the weather ETL artifact bucket:
    artifacts/glyphs/**/*.pbf     -> s3://<bucket>/glyphs/
    artifacts/pmtiles/**/*.pmtiles -> s3://<bucket>/pmtiles/
    artifacts/radio/**/*.json      -> s3://<bucket>/radio/
    artifacts/radio/**/*.mp3       -> s3://<bucket>/radio/

  The script copies matching files and does not delete extra S3 objects.

Options:
  --bucket <name>          Artifact bucket name. Default: terraform output artifacts_bucket_name.
  --artifact-root <path>   Local artifact root. Default: repo artifacts/.
  --stack-dir <path>       Terraform stack dir. Default: infra/weather-etl.
  --dry-run                Print AWS CLI dry-run operations without uploading.
  -h, --help               Show this help and exit.

Environment defaults:
  ARTIFACTS_BUCKET, ARTIFACT_ROOT, STACK_DIR, AWS_REGION, DRY_RUN, ALLOW_EMPTY,
  GLYPH_CACHE_CONTROL, PMTILES_CACHE_CONTROL, RADIO_PLAYLIST_CACHE_CONTROL,
  RADIO_AUDIO_CACHE_CONTROL.

  RADIO_CACHE_CONTROL is a legacy fallback used for both radio groups when the
  more specific radio cache variables are unset.
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    echo "Error: $flag requires a value." >&2
    usage >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --bucket)
      require_value "$1" "${2:-}"
      ARTIFACTS_BUCKET="$2"
      shift 2
      ;;
    --bucket=*)
      ARTIFACTS_BUCKET="${1#*=}"
      require_value "--bucket" "$ARTIFACTS_BUCKET"
      shift
      ;;
    --artifact-root)
      require_value "$1" "${2:-}"
      ARTIFACT_ROOT="$2"
      shift 2
      ;;
    --artifact-root=*)
      ARTIFACT_ROOT="${1#*=}"
      require_value "--artifact-root" "$ARTIFACT_ROOT"
      shift
      ;;
    --stack-dir)
      require_value "$1" "${2:-}"
      STACK_DIR="$2"
      shift 2
      ;;
    --stack-dir=*)
      STACK_DIR="${1#*=}"
      require_value "--stack-dir" "$STACK_DIR"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      echo "Error: unexpected argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd aws
require_cmd find

if [[ ! -d "$ARTIFACT_ROOT" ]]; then
  echo "Artifact root not found: $ARTIFACT_ROOT" >&2
  exit 1
fi

if [[ -z "$ARTIFACTS_BUCKET" ]]; then
  require_cmd terraform
  if [[ ! -d "$STACK_DIR" ]]; then
    echo "Terraform stack dir not found: $STACK_DIR" >&2
    exit 1
  fi
  ARTIFACTS_BUCKET="$(cd "$STACK_DIR" && terraform output -raw artifacts_bucket_name)"
fi

count_files() {
  local source_dir="$1"
  local pattern="$2"

  if [[ ! -d "$source_dir" ]]; then
    echo "0"
    return
  fi

  find "$source_dir" -type f -name "$pattern" | wc -l | tr -d ' '
}

upload_group() {
  local label="$1"
  local source_dir="$2"
  local dest_prefix="$3"
  local pattern="$4"
  local content_type="$5"
  local cache_control="$6"
  local count

  count="$(count_files "$source_dir" "$pattern")"
  if [[ "$count" == "0" ]]; then
    if [[ "$ALLOW_EMPTY" == "true" ]]; then
      echo "Skipping $label: no matching files under $source_dir"
      return
    fi
    echo "No $label files found under $source_dir matching $pattern" >&2
    echo "Set ALLOW_EMPTY=true to skip empty groups." >&2
    exit 1
  fi

  echo
  echo "Uploading $label"
  echo "  files:         $count"
  echo "  source:        $source_dir/"
  echo "  destination:   s3://$ARTIFACTS_BUCKET/$dest_prefix/"
  echo "  content-type:  $content_type"
  echo "  cache-control: $cache_control"

  local args=(
    s3 cp "$source_dir/" "s3://$ARTIFACTS_BUCKET/$dest_prefix/"
    --recursive
    --exclude "*"
    --include "$pattern"
    --content-type "$content_type"
    --cache-control "$cache_control"
    --region "$AWS_REGION"
    --no-progress
  )

  if [[ "$DRY_RUN" == "true" ]]; then
    args+=(--dryrun)
  fi

  aws "${args[@]}"
}

echo "Uploading static weather-map artifacts"
echo "  bucket:        $ARTIFACTS_BUCKET"
echo "  artifact_root: $ARTIFACT_ROOT"
echo "  region:        $AWS_REGION"
echo "  dry_run:       $DRY_RUN"

upload_group "glyph PBFs" "$ARTIFACT_ROOT/glyphs" "glyphs" "*.pbf" "application/x-protobuf" "$GLYPH_CACHE_CONTROL"
upload_group \
  "PMTiles" "$ARTIFACT_ROOT/pmtiles" "pmtiles" "*.pmtiles" \
  "application/octet-stream" "$PMTILES_CACHE_CONTROL"
upload_group \
  "radio playlist JSON" "$ARTIFACT_ROOT/radio" "radio" "*.json" \
  "application/json" "$RADIO_PLAYLIST_CACHE_CONTROL"
upload_group \
  "radio MP3s" "$ARTIFACT_ROOT/radio" "radio" "*.mp3" \
  "audio/mpeg" "$RADIO_AUDIO_CACHE_CONTROL"

echo
echo "Done."
