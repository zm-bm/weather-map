#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ETL_DIR="$REPO_ROOT/etl"
STACK_DIR="${STACK_DIR:-$REPO_ROOT/infra/weather-etl}"
CONFIG_FILE="$REPO_ROOT/config/pipeline.json"
CATALOG_FILE="$REPO_ROOT/config/catalog.json"
source "$REPO_ROOT/scripts/lib/etl-image-build.sh"

AWS_REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="${IMAGE_TAG:-}"
ETL_CODE_REVISION="${ETL_CODE_REVISION:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"
LAMBDA_PYTHON_VERSION="3.12"
DIST_DIR="${DIST_DIR:-$ETL_DIR/dist}"
OUTPUT_ZIP="${OUTPUT_ZIP:-$DIST_DIR/weather-etl-ingest-lambda.zip}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$REPO_ROOT/artifacts}"
ARTIFACTS_BUCKET="${ARTIFACTS_BUCKET:-}"

PLAN_ONLY="false"
AUTO_APPROVE="false"
UPLOAD_STATIC="false"

DEFAULT_RADIO_PLAYLIST_CACHE_CONTROL="public, max-age=60, s-maxage=300, stale-while-revalidate=60"
DEFAULT_RADIO_AUDIO_CACHE_CONTROL="public, max-age=86400, s-maxage=604800"
GLYPH_CACHE_CONTROL="${GLYPH_CACHE_CONTROL:-public, max-age=604800, s-maxage=2592000}"
PMTILES_CACHE_CONTROL="${PMTILES_CACHE_CONTROL:-public, max-age=86400, s-maxage=604800}"
RADIO_CACHE_CONTROL="${RADIO_CACHE_CONTROL:-}"
RADIO_PLAYLIST_CACHE_CONTROL="${RADIO_PLAYLIST_CACHE_CONTROL:-${RADIO_CACHE_CONTROL:-$DEFAULT_RADIO_PLAYLIST_CACHE_CONTROL}}"
RADIO_AUDIO_CACHE_CONTROL="${RADIO_AUDIO_CACHE_CONTROL:-${RADIO_CACHE_CONTROL:-$DEFAULT_RADIO_AUDIO_CACHE_CONTROL}}"
ALLOW_EMPTY="${ALLOW_EMPTY:-false}"

usage() {
  cat <<'EOF'
Usage:
  scripts/etl-deploy.sh [--plan-only] [--auto-approve] [--upload-static] [--image-tag <tag>]

Description:
  Deploys the weather ETL stack in the correct order:
    1. build the shared Lambda zip;
    2. run Terraform init/validate/plan with one worker image tag;
    3. after approval, create/update the Terraform-owned ECR repository;
    4. build and push the split ETL worker base/app image using that tag;
    5. apply the full Terraform stack;
    6. optionally upload static glyph/PMTiles/radio assets.

Options:
  --plan-only       Build the Lambda zip and run Terraform plan, then exit.
  --auto-approve    Do not prompt before applying Terraform or pushing images.
  --upload-static   Upload static artifacts after the final Terraform apply.
  --image-tag <tag> Override the default image tag, which is git short HEAD.
  -h, --help        Show this help and exit.

Environment:
  AWS_REGION, IMAGE_TAG, ETL_CODE_REVISION, PYTHON_BIN, DIST_DIR, OUTPUT_ZIP,
  STACK_DIR, ARTIFACT_ROOT, ARTIFACTS_BUCKET, ALLOW_EMPTY, GLYPH_CACHE_CONTROL,
  PMTILES_CACHE_CONTROL, RADIO_PLAYLIST_CACHE_CONTROL, RADIO_AUDIO_CACHE_CONTROL.
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

run_cmd() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --plan-only)
      PLAN_ONLY="true"
      shift
      ;;
    --auto-approve)
      AUTO_APPROVE="true"
      shift
      ;;
    --upload-static)
      UPLOAD_STATIC="true"
      shift
      ;;
    --image-tag)
      require_value "$1" "${2:-}"
      IMAGE_TAG="$2"
      shift 2
      ;;
    --image-tag=*)
      IMAGE_TAG="${1#*=}"
      require_value "--image-tag" "$IMAGE_TAG"
      shift
      ;;
    *)
      echo "Error: unexpected argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$IMAGE_TAG" ]]; then
  IMAGE_TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
fi

TF=(terraform "-chdir=$STACK_DIR")

build_lambda_bundle() {
  require_cmd zip
  require_cmd sha256sum
  require_cmd "$PYTHON_BIN"

  local python_version
  python_version="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "$python_version" != "$LAMBDA_PYTHON_VERSION" ]]; then
    echo "Python $LAMBDA_PYTHON_VERSION is required to build this Lambda artifact; got $python_version from $PYTHON_BIN" >&2
    exit 1
  fi

  local tmp_dir stage_dir tmp_zip build_venv build_python build_src zip_basename sha256
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN
  stage_dir="$tmp_dir/stage"
  zip_basename="$(basename "$OUTPUT_ZIP")"
  tmp_zip="$tmp_dir/$zip_basename"
  build_venv="$tmp_dir/venv"
  build_python="$build_venv/bin/python"
  build_src="$tmp_dir/src"

  mkdir -p "$stage_dir" "$DIST_DIR" "$build_src"
  for required_file in "$CONFIG_FILE" "$CATALOG_FILE"; do
    if [[ ! -f "$required_file" ]]; then
      echo "Missing required file for Lambda bundle: $required_file" >&2
      exit 1
    fi
  done

  PYTHONDONTWRITEBYTECODE=1 "$PYTHON_BIN" -m venv "$build_venv"
  cp "$ETL_DIR/pyproject.toml" "$build_src/pyproject.toml"
  cp -R "$ETL_DIR/weather_etl" "$build_src/weather_etl"

  PYTHONDONTWRITEBYTECODE=1 "$build_python" -m pip --isolated install \
    --disable-pip-version-check \
    --no-cache-dir \
    "setuptools>=64" >/dev/null

  PYTHONDONTWRITEBYTECODE=1 "$build_python" -m pip --isolated install \
    --disable-pip-version-check \
    --ignore-installed \
    --no-cache-dir \
    --no-compile \
    --no-build-isolation \
    --target "$stage_dir" \
    "$build_src" >/dev/null

  mkdir -p "$stage_dir/config"
  cp "$CONFIG_FILE" "$stage_dir/config/pipeline.json"
  cp "$CATALOG_FILE" "$stage_dir/config/catalog.json"

  find "$stage_dir" -type d -name '__pycache__' -prune -exec rm -rf {} +
  find "$stage_dir" -type f -name '*.pyc' -delete
  rm -rf "$stage_dir/bin"
  find "$stage_dir" -type f -exec touch -t 200001010000 {} +

  mapfile -t files < <(
    cd "$stage_dir"
    find . -type f | sed 's#^\./##' | LC_ALL=C sort
  )

  (
    cd "$stage_dir"
    zip -X -q "$tmp_zip" "${files[@]}"
  )

  if [[ -f "$OUTPUT_ZIP" ]] && cmp -s "$tmp_zip" "$OUTPUT_ZIP"; then
    sha256="$(sha256sum "$OUTPUT_ZIP" | awk '{print $1}')"
    echo "Lambda artifact already up to date: $OUTPUT_ZIP"
    echo "sha256: $sha256"
    return
  fi

  mv "$tmp_zip" "$OUTPUT_ZIP"
  sha256="$(sha256sum "$OUTPUT_ZIP" | awk '{print $1}')"
  echo "Wrote Lambda artifact: $OUTPUT_ZIP"
  echo "sha256: $sha256"
}

terraform_plan() {
  run_cmd "${TF[@]}" plan -var "worker_image_tag=$IMAGE_TAG"
}

terraform_apply_ecr_repository() {
  run_cmd "${TF[@]}" apply \
    -auto-approve \
    -target=aws_ecr_repository.worker \
    -var "worker_image_tag=$IMAGE_TAG"
}

terraform_apply_stack() {
  run_cmd "${TF[@]}" apply \
    -auto-approve \
    -var "worker_image_tag=$IMAGE_TAG"
}

confirm_mutation() {
  if [[ "$AUTO_APPROVE" == "true" ]]; then
    return
  fi

  local reply
  printf 'Create ECR, push the ETL worker image, and apply the full stack? [y/N] '
  if ! read -r reply; then
    reply=""
  fi
  case "$reply" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Deploy stopped after plan."
      exit 0
      ;;
  esac
}

build_and_push_worker_image() {
  require_cmd aws
  require_cmd docker

  local ecr_image_uri ecr_registry ecr_repository
  local base_fingerprint app_fingerprint base_image_tag base_image_latest app_image_tag app_image_latest
  local etl_image_identity base_build_reason app_build_reason base_rebuilt

  ecr_image_uri="$("${TF[@]}" output -raw worker_ecr_repository_url)"
  ecr_registry="${ecr_image_uri%%/*}"
  ecr_repository="${ecr_image_uri#*/}"
  base_fingerprint="$(etl_base_image_source_fingerprint "$REPO_ROOT")"
  app_fingerprint="$(etl_app_image_source_fingerprint "$REPO_ROOT")"
  base_image_tag="${ecr_image_uri}:base-${base_fingerprint}"
  base_image_latest="${ecr_image_uri}:base-latest"
  app_image_tag="${ecr_image_uri}:${IMAGE_TAG}"
  app_image_latest="${ecr_image_uri}:latest"
  etl_image_identity="${ETL_IMAGE_IDENTITY:-${app_image_tag}@base-${base_fingerprint}.app-${app_fingerprint}}"
  base_rebuilt="false"

  echo "Worker image:"
  echo "  repository:    $ecr_image_uri"
  echo "  base tag:      base-$base_fingerprint"
  echo "  app tag:       $IMAGE_TAG"
  echo "  code revision: $ETL_CODE_REVISION"

  aws ecr describe-repositories \
    --repository-names "$ecr_repository" \
    --region "$AWS_REGION" >/dev/null

  base_build_reason="$(etl_base_image_rebuild_reason "$base_image_latest" "$base_fingerprint" "false")"
  if [[ -n "$base_build_reason" ]]; then
    echo "Building ETL base image ($base_build_reason)"
    run_cmd docker build \
      --label "$ETL_BASE_FINGERPRINT_LABEL=${base_fingerprint}" \
      -f "$REPO_ROOT/etl/Dockerfile.base" \
      -t "$base_image_tag" \
      -t "$base_image_latest" \
      "$REPO_ROOT"
    base_rebuilt="true"
  else
    echo "ETL base image is current; reusing local base-latest."
    run_cmd docker tag "$base_image_latest" "$base_image_tag"
  fi

  app_build_reason="$(etl_app_image_rebuild_reason "$app_image_latest" "$app_fingerprint" "$base_fingerprint" "$base_rebuilt" "false")"
  if [[ -n "$app_build_reason" ]]; then
    echo "Building ETL app image ($app_build_reason)"
    run_cmd docker build \
      --build-arg "ETL_BASE_IMAGE=${base_image_tag}" \
      --build-arg "ETL_CODE_REVISION=${ETL_CODE_REVISION}" \
      --build-arg "ETL_IMAGE_IDENTITY=${etl_image_identity}" \
      --label "$ETL_BASE_FINGERPRINT_LABEL=${base_fingerprint}" \
      --label "$ETL_APP_FINGERPRINT_LABEL=${app_fingerprint}" \
      -f "$REPO_ROOT/etl/Dockerfile" \
      -t "$app_image_tag" \
      -t "$app_image_latest" \
      "$REPO_ROOT"
  else
    echo "ETL app image is current; reusing local latest."
    run_cmd docker tag "$app_image_latest" "$app_image_tag"
  fi

  echo "Logging into ECR"
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ecr_registry"

  run_cmd docker push "$base_image_tag"
  run_cmd docker push "$base_image_latest"
  run_cmd docker push "$app_image_tag"
  run_cmd docker push "$app_image_latest"
}

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

  run_cmd aws s3 cp "$source_dir/" "s3://$ARTIFACTS_BUCKET/$dest_prefix/" \
    --recursive \
    --exclude "*" \
    --include "$pattern" \
    --content-type "$content_type" \
    --cache-control "$cache_control" \
    --region "$AWS_REGION" \
    --no-progress
}

upload_static_artifacts() {
  require_cmd aws
  require_cmd find

  if [[ ! -d "$ARTIFACT_ROOT" ]]; then
    echo "Artifact root not found: $ARTIFACT_ROOT" >&2
    exit 1
  fi
  if [[ -z "$ARTIFACTS_BUCKET" ]]; then
    ARTIFACTS_BUCKET="$("${TF[@]}" output -raw artifacts_bucket_name)"
  fi

  echo "Uploading static weather-map artifacts"
  echo "  bucket:        $ARTIFACTS_BUCKET"
  echo "  artifact_root: $ARTIFACT_ROOT"
  echo "  region:        $AWS_REGION"

  upload_group "glyph PBFs" "$ARTIFACT_ROOT/glyphs" "glyphs" "*.pbf" "application/x-protobuf" "$GLYPH_CACHE_CONTROL"
  upload_group "PMTiles" "$ARTIFACT_ROOT/pmtiles" "pmtiles" "*.pmtiles" "application/octet-stream" "$PMTILES_CACHE_CONTROL"
  upload_group "radio playlist JSON" "$ARTIFACT_ROOT/radio" "radio" "*.json" "application/json" "$RADIO_PLAYLIST_CACHE_CONTROL"
  upload_group "radio MP3s" "$ARTIFACT_ROOT/radio" "radio" "*.mp3" "audio/mpeg" "$RADIO_AUDIO_CACHE_CONTROL"
}

require_cmd terraform

echo "Deploying weather ETL"
echo "  stack:        $STACK_DIR"
echo "  region:       $AWS_REGION"
echo "  image_tag:    $IMAGE_TAG"
echo "  lambda_zip:   $OUTPUT_ZIP"
echo "  upload_static: $UPLOAD_STATIC"

build_lambda_bundle
run_cmd "${TF[@]}" init
run_cmd "${TF[@]}" validate
terraform_plan

if [[ "$PLAN_ONLY" == "true" ]]; then
  echo "Plan-only deploy complete; no AWS mutations were performed by this script."
  exit 0
fi

confirm_mutation
terraform_apply_ecr_repository
build_and_push_worker_image
terraform_apply_stack

if [[ "$UPLOAD_STATIC" == "true" ]]; then
  upload_static_artifacts
fi

echo
echo "Deploy complete."
echo "  image_tag: $IMAGE_TAG"
"${TF[@]}" output etl_runtime_contract
