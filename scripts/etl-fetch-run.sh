#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
  scripts/etl-fetch-run.sh --dataset-id <dataset> --cycle <YYYYMMDDHH> --run-id <run_id> --artifact-root-uri <s3://bucket/prefix> [--dest artifacts] [--include-public]

Copies one completed ETL run into the local artifacts tree. This script does not
submit, validate, publish, or infer latest runs.
EOF
}

die() {
	echo "error: $*" >&2
	exit 2
}

dataset_id="${DATASET_ID:-}"
cycle="${CYCLE:-}"
run_id="${RUN_ID:-}"
artifact_root_uri="${ARTIFACT_ROOT_URI:-}"
dest="${DEST:-artifacts}"
include_public=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dataset-id)
			dataset_id="${2:-}"
			shift 2
			;;
		--cycle)
			cycle="${2:-}"
			shift 2
			;;
		--run-id)
			run_id="${2:-}"
			shift 2
			;;
		--artifact-root-uri)
			artifact_root_uri="${2:-}"
			shift 2
			;;
		--dest)
			dest="${2:-}"
			shift 2
			;;
		--include-public)
			include_public=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown argument: $1"
			;;
	esac
done

[[ -n "$dataset_id" ]] || die "--dataset-id is required"
[[ -n "$cycle" ]] || die "--cycle is required"
[[ -n "$run_id" ]] || die "--run-id is required"
[[ -n "$artifact_root_uri" ]] || die "--artifact-root-uri is required"
[[ "$artifact_root_uri" == s3://* ]] || die "--artifact-root-uri must be an s3:// URI"

artifact_root_uri="${artifact_root_uri%/}"
dest="${dest%/}"
run_path="runs/$dataset_id/$cycle/$run_id"

echo "Fetching run $dataset_id/$cycle/$run_id"
mkdir -p "$dest/$run_path"
aws s3 sync "$artifact_root_uri/$run_path/" "$dest/$run_path/"

copy_public_file() {
	local relative_path="$1"
	mkdir -p "$dest/$(dirname "$relative_path")"
	aws s3 cp "$artifact_root_uri/$relative_path" "$dest/$relative_path"
}

if [[ "$include_public" == true ]]; then
	copy_public_file "manifests/index.json"
	copy_public_file "manifests/$dataset_id/latest.json"
	copy_public_file "manifests/$dataset_id/cycles/$cycle/current.json"
	copy_public_file "manifests/$dataset_id/cycles/$cycle/runs/$run_id.json"
	copy_public_file "status.json"
fi
