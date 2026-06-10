#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

echo "Region:        ${AWS_REGION}"
echo "Account:       ${ACCOUNT_ID}"
echo "Repository:    ${ECR_REPOSITORY}"
echo "Image URI:     ${ECR_IMAGE_URI}"
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

echo "Building ETL image from etl/Dockerfile"
docker build \
  --build-arg "ETL_CODE_REVISION=${ETL_CODE_REVISION}" \
  --build-arg "ETL_IMAGE_IDENTITY=${ECR_IMAGE_URI}:${IMAGE_TAG}" \
  -f "$REPO_ROOT/etl/Dockerfile" \
  -t "${ECR_IMAGE_URI}:${IMAGE_TAG}" \
  -t "${ECR_IMAGE_URI}:latest" \
  "$REPO_ROOT"

if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "Logging into ECR"
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$ECR_REGISTRY"

  echo "Pushing ${ECR_IMAGE_URI}:${IMAGE_TAG}"
  docker push "${ECR_IMAGE_URI}:${IMAGE_TAG}"

  echo "Pushing ${ECR_IMAGE_URI}:latest"
  docker push "${ECR_IMAGE_URI}:latest"
else
  echo "PUSH_IMAGE=false; skipping push"
fi

echo
echo "Done."
echo "ECR image (tag):   ${ECR_IMAGE_URI}:${IMAGE_TAG}"
echo "ECR image (latest): ${ECR_IMAGE_URI}:latest"
