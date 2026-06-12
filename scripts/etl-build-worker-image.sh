#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$REPO_ROOT/scripts/lib/etl-image-build.sh"

AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY="${ECR_REPOSITORY:-weather-etl-worker}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
ETL_CODE_REVISION="${ETL_CODE_REVISION:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
PUSH_IMAGE="${PUSH_IMAGE:-true}"
CREATE_REPO_IF_MISSING="${CREATE_REPO_IF_MISSING:-false}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd aws
require_cmd docker

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}"
BASE_FINGERPRINT="$(etl_base_image_source_fingerprint "$REPO_ROOT")"
APP_FINGERPRINT="$(etl_app_image_source_fingerprint "$REPO_ROOT")"
BASE_IMAGE_TAG="${ECR_IMAGE_URI}:base-${BASE_FINGERPRINT}"
BASE_IMAGE_LATEST="${ECR_IMAGE_URI}:base-latest"
APP_IMAGE_TAG="${ECR_IMAGE_URI}:${IMAGE_TAG}"
APP_IMAGE_LATEST="${ECR_IMAGE_URI}:latest"
ETL_IMAGE_IDENTITY="${ETL_IMAGE_IDENTITY:-${APP_IMAGE_TAG}@base-${BASE_FINGERPRINT}.app-${APP_FINGERPRINT}}"

echo "Region:        ${AWS_REGION}"
echo "Account:       ${ACCOUNT_ID}"
echo "Repository:    ${ECR_REPOSITORY}"
echo "Image URI:     ${ECR_IMAGE_URI}"
echo "Base tag:      base-${BASE_FINGERPRINT}"
echo "Image tag:     ${IMAGE_TAG}"
echo "Code revision: ${ETL_CODE_REVISION}"

if [[ "$CREATE_REPO_IF_MISSING" == "true" ]]; then
  if ! aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "Creating ECR repository: ${ECR_REPOSITORY}"
    aws ecr create-repository \
      --repository-name "$ECR_REPOSITORY" \
      --image-scanning-configuration scanOnPush=true \
      --region "$AWS_REGION" >/dev/null
  fi
elif ! aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "ECR repository not found: ${ECR_REPOSITORY}" >&2
  echo "Run Terraform apply first so the Terraform-managed repository exists." >&2
  exit 1
fi

base_build_reason=""
app_build_reason=""
base_rebuilt="false"

base_build_reason="$(etl_base_image_rebuild_reason "$BASE_IMAGE_LATEST" "$BASE_FINGERPRINT" "false")"
if [[ -n "$base_build_reason" ]]; then
  echo "Building ETL base image ($base_build_reason)"
  docker build \
    --label "$ETL_BASE_FINGERPRINT_LABEL=${BASE_FINGERPRINT}" \
    -f "$REPO_ROOT/etl/Dockerfile.base" \
    -t "$BASE_IMAGE_TAG" \
    -t "$BASE_IMAGE_LATEST" \
    "$REPO_ROOT"
  base_rebuilt="true"
else
  echo "ETL base image is current; reusing local base-latest."
  docker tag "$BASE_IMAGE_LATEST" "$BASE_IMAGE_TAG"
fi

app_build_reason="$(etl_app_image_rebuild_reason "$APP_IMAGE_LATEST" "$APP_FINGERPRINT" "$BASE_FINGERPRINT" "$base_rebuilt" "false")"
if [[ -n "$app_build_reason" ]]; then
  echo "Building ETL app image ($app_build_reason)"
  docker build \
    --build-arg "ETL_BASE_IMAGE=${BASE_IMAGE_TAG}" \
    --build-arg "ETL_CODE_REVISION=${ETL_CODE_REVISION}" \
    --build-arg "ETL_IMAGE_IDENTITY=${ETL_IMAGE_IDENTITY}" \
    --label "$ETL_BASE_FINGERPRINT_LABEL=${BASE_FINGERPRINT}" \
    --label "$ETL_APP_FINGERPRINT_LABEL=${APP_FINGERPRINT}" \
    -f "$REPO_ROOT/etl/Dockerfile" \
    -t "$APP_IMAGE_TAG" \
    -t "$APP_IMAGE_LATEST" \
    "$REPO_ROOT"
else
  echo "ETL app image is current; reusing local latest."
  docker tag "$APP_IMAGE_LATEST" "$APP_IMAGE_TAG"
fi

if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "Logging into ECR"
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ECR_REGISTRY"

  echo "Pushing ${BASE_IMAGE_TAG}"
  docker push "${BASE_IMAGE_TAG}"

  echo "Pushing ${BASE_IMAGE_LATEST}"
  docker push "${BASE_IMAGE_LATEST}"

  echo "Pushing ${APP_IMAGE_TAG}"
  docker push "${APP_IMAGE_TAG}"

  echo "Pushing ${APP_IMAGE_LATEST}"
  docker push "${APP_IMAGE_LATEST}"
else
  echo "PUSH_IMAGE=false; skipping push"
fi

echo
echo "Done."
echo "ECR base image (tag):    ${BASE_IMAGE_TAG}"
echo "ECR base image (latest): ${BASE_IMAGE_LATEST}"
echo "ECR app image (tag):     ${APP_IMAGE_TAG}"
echo "ECR app image (latest):  ${APP_IMAGE_LATEST}"
