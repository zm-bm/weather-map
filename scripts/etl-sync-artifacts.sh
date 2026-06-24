#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
  scripts/etl-sync-artifacts.sh --artifact-root-uri <s3://bucket/prefix> [--dataset-id gfs] [--dest artifacts]
  scripts/etl-sync-artifacts.sh --artifact-root-uri <s3://bucket/prefix> --dataset-id gfs --cycle <YYYYMMDDHH> --run-id <run_id>

Fetches published ETL run artifacts into the local artifacts tree. With no run
id, the latest published run is selected from manifests/index.json. For a
specific run, pass both --cycle and --run-id.
EOF
}

die() {
	echo "error: $*" >&2
	exit 2
}

artifact_root_uri="${ARTIFACT_ROOT_URI:-}"
cycle="${CYCLE:-}"
run_id="${RUN_ID:-}"
dest="${DEST:-artifacts}"
all_latest=false
dataset_ids=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--artifact-root-uri)
			artifact_root_uri="${2:-}"
			shift 2
			;;
		--artifact-root-uri=*)
			artifact_root_uri="${1#*=}"
			shift
			;;
		--dataset-id)
			dataset_ids+=("${2:-}")
			shift 2
			;;
		--dataset-id=*)
			dataset_ids+=("${1#*=}")
			shift
			;;
		--cycle)
			cycle="${2:-}"
			shift 2
			;;
		--cycle=*)
			cycle="${1#*=}"
			shift
			;;
		--run-id)
			run_id="${2:-}"
			shift 2
			;;
		--run-id=*)
			run_id="${1#*=}"
			shift
			;;
		--dest)
			dest="${2:-}"
			shift 2
			;;
		--dest=*)
			dest="${1#*=}"
			shift
			;;
		--all)
			all_latest=true
			shift
			;;
		--include-public)
			# Public manifests are always copied now. Keep the flag accepted for old commands.
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

[[ -n "$artifact_root_uri" ]] || die "--artifact-root-uri is required"
[[ "$artifact_root_uri" == s3://* ]] || die "--artifact-root-uri must be an s3:// URI"
if [[ "$all_latest" == true && -n "$run_id" ]]; then
	die "--all cannot be used with --run-id"
fi
if [[ -n "$run_id" && -z "$cycle" ]]; then
	die "--cycle is required when --run-id is provided"
fi
if [[ -z "$run_id" && -n "$cycle" ]]; then
	die "--run-id is required when --cycle is provided"
fi
if [[ "$all_latest" == true && "${#dataset_ids[@]}" -gt 0 ]]; then
	die "--all cannot be combined with --dataset-id"
fi

if [[ "${#dataset_ids[@]}" -eq 0 && "$all_latest" != true ]]; then
	dataset_ids+=("${DATASET_ID:-gfs}")
fi
for dataset_id in "${dataset_ids[@]}"; do
	[[ -n "$dataset_id" ]] || die "--dataset-id must not be empty"
done

artifact_root_uri="${artifact_root_uri%/}"
dest="${dest%/}"

copy_public_file() {
	local relative_path="$1"
	mkdir -p "$dest/$(dirname "$relative_path")"
	aws s3 cp "$artifact_root_uri/$relative_path" "$dest/$relative_path"
}

copy_optional_public_file() {
	local relative_path="$1"
	mkdir -p "$dest/$(dirname "$relative_path")"
	if aws s3 cp "$artifact_root_uri/$relative_path" "$dest/$relative_path"; then
		return
	fi
	echo "warning: optional public file not copied: $relative_path" >&2
}

selected_latest_run() {
	local index_path="$1"
	local dataset_id="$2"
	python3 - "$index_path" "$dataset_id" <<'PY'
import json
import sys

index_path = sys.argv[1]
dataset_id = sys.argv[2]
with open(index_path, encoding="utf-8") as fh:
    index = json.load(fh)
try:
    latest = index["datasets"][dataset_id]["latest"]
    run = latest["run"]
    cycle = run["cycle"]
    run_id = run["run_id"]
    payload_root = run["payload_root"]
except KeyError as exc:
    raise SystemExit(f"missing latest manifest field for dataset {dataset_id}: {exc}") from exc

if not all(isinstance(value, str) and value for value in (cycle, run_id, payload_root)):
    raise SystemExit(f"invalid latest manifest run metadata for dataset {dataset_id}")
print("\t".join((cycle, run_id, payload_root)))
PY
}

all_latest_dataset_ids() {
	local index_path="$1"
	python3 - "$index_path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    index = json.load(fh)
datasets = index.get("datasets")
if not isinstance(datasets, dict):
    raise SystemExit("manifest index datasets must be an object")
for dataset_id, dataset in datasets.items():
    if isinstance(dataset, dict) and dataset.get("latest") is not None:
        print(dataset_id)
PY
}

selected_manifest_run() {
	local manifest_path="$1"
	local expected_cycle="$2"
	local expected_run_id="$3"
	python3 - "$manifest_path" "$expected_cycle" "$expected_run_id" <<'PY'
import json
import sys

manifest_path = sys.argv[1]
expected_cycle = sys.argv[2]
expected_run_id = sys.argv[3]
with open(manifest_path, encoding="utf-8") as fh:
    manifest = json.load(fh)
try:
    run = manifest["run"]
    cycle = run["cycle"]
    run_id = run["run_id"]
    payload_root = run["payload_root"]
except KeyError as exc:
    raise SystemExit(f"missing run manifest field: {exc}") from exc

if cycle != expected_cycle:
    raise SystemExit(f"run manifest cycle mismatch: expected {expected_cycle}, got {cycle}")
if run_id != expected_run_id:
    raise SystemExit(f"run manifest run_id mismatch: expected {expected_run_id}, got {run_id}")
if not isinstance(payload_root, str) or not payload_root:
    raise SystemExit("run manifest payload_root must be a non-empty string")
print(payload_root)
PY
}

manifest_payload_paths() {
	local manifest_path="$1"
	python3 - "$manifest_path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    manifest = json.load(fh)

paths = set()
artifacts = manifest.get("artifacts")
if not isinstance(artifacts, dict):
    raise SystemExit("manifest artifacts must be an object")

for artifact in artifacts.values():
    if not isinstance(artifact, dict):
        continue
    frames = artifact.get("frames")
    if not isinstance(frames, dict):
        continue
    for frame in frames.values():
        if not isinstance(frame, dict):
            continue
        path = frame.get("path")
        if isinstance(path, str) and path:
            paths.add(path)

for path in sorted(paths):
    print(path)
PY
}

write_local_manifest_index() {
	local index_path="$1"
	shift
	python3 - "$index_path" "$@" <<'PY'
import json
import sys
from pathlib import Path

index_path = Path(sys.argv[1])
specs = sys.argv[2:]
with index_path.open(encoding="utf-8") as fh:
    index = json.load(fh)

source_datasets = index.get("datasets")
if not isinstance(source_datasets, dict):
    raise SystemExit("manifest index datasets must be an object")


def compact_latest(manifest):
    frames = manifest.get("frames")
    artifacts = manifest.get("artifacts")
    if not isinstance(frames, list):
        raise SystemExit("manifest frames must be an array")
    if not isinstance(artifacts, dict):
        raise SystemExit("manifest artifacts must be an object")

    frame_ids = []
    for frame in frames:
        if not isinstance(frame, dict) or not isinstance(frame.get("id"), str):
            raise SystemExit("manifest frame ids must be strings")
        frame_ids.append(frame["id"])

    return {
        "run": manifest["run"],
        "frames": frames,
        "artifacts": {
            artifact_id: compact_artifact(artifact_id, artifact, frame_ids)
            for artifact_id, artifact in artifacts.items()
        },
    }


def compact_artifact(artifact_id, artifact, frame_ids):
    if not isinstance(artifact, dict):
        raise SystemExit(f"manifest artifact {artifact_id!r} must be an object")
    frames = artifact.get("frames")
    if not isinstance(frames, dict):
        raise SystemExit(f"manifest artifact {artifact_id!r} frames must be an object")

    byte_length = None
    for frame_id in frame_ids:
        frame = frames.get(frame_id)
        if not isinstance(frame, dict):
            raise SystemExit(f"manifest artifact {artifact_id!r} frame {frame_id!r} must be an object")
        frame_byte_length = frame.get("byte_length")
        if not isinstance(frame_byte_length, int):
            raise SystemExit(f"manifest artifact {artifact_id!r} frame {frame_id!r} byte_length must be an integer")
        if byte_length is None:
            byte_length = frame_byte_length
        elif byte_length != frame_byte_length:
            raise SystemExit(
                "manifest artifact frame byte_length mismatch: "
                f"artifact={artifact_id!r} first={byte_length} {frame_id}={frame_byte_length}"
            )

    if byte_length is None:
        raise SystemExit(f"manifest artifact {artifact_id!r} has no frames")

    compact = {
        key: value
        for key, value in artifact.items()
        if key != "frames"
    }
    compact["byte_length"] = byte_length
    return compact


selected_dataset_ids = set()
selected_datasets = {}
for spec in specs:
    dataset_id, manifest_path = spec.split("=", 1)
    with Path(manifest_path).open(encoding="utf-8") as fh:
        manifest = json.load(fh)
    source_dataset = source_datasets.get(dataset_id)
    dataset = dict(source_dataset) if isinstance(source_dataset, dict) else {}
    manifest_dataset = manifest.get("dataset")
    manifest_label = manifest_dataset.get("label") if isinstance(manifest_dataset, dict) else None
    source_latest = dataset.get("latest") if isinstance(dataset.get("latest"), dict) else None
    source_run = source_latest.get("run") if isinstance(source_latest, dict) else None
    manifest_run = manifest.get("run") if isinstance(manifest.get("run"), dict) else None
    dataset["label"] = dataset.get("label") or manifest_label or dataset_id
    if (
        isinstance(source_latest, dict)
        and isinstance(source_run, dict)
        and isinstance(manifest_run, dict)
        and source_run.get("cycle") == manifest_run.get("cycle")
        and source_run.get("run_id") == manifest_run.get("run_id")
    ):
        dataset["latest"] = source_latest
    else:
        dataset["latest"] = compact_latest(manifest)
    selected_datasets[dataset_id] = dataset
    selected_dataset_ids.add(dataset_id)

index["datasets"] = selected_datasets
layers = index.get("layers")
if isinstance(layers, dict):
    for layer in layers.values():
        layer_datasets = layer.get("datasets") if isinstance(layer, dict) else None
        if isinstance(layer_datasets, dict):
            layer["datasets"] = {
                dataset_id: value
                for dataset_id, value in layer_datasets.items()
                if dataset_id in selected_dataset_ids
            }

index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
PY
}

sync_run_payloads() {
	local dataset_id="$1"
	local selected_cycle="$2"
	local selected_run_id="$3"
	local payload_root="$4"
	local manifest_path="$5"
	local run_path="runs/$dataset_id/$selected_cycle/$selected_run_id"
	local payload_prefix="${payload_root%/}/"
	local payload_path
	local relative_path
	local has_outside_payload_root=false
	local payload_paths=()
	local include_args=()

	echo "Fetching ETL run $dataset_id/$selected_cycle/$selected_run_id"
	echo "  payload_root: $payload_root"
	mkdir -p "$dest/$run_path" "$dest/$payload_root"
	aws s3 sync "$artifact_root_uri/$run_path/" "$dest/$run_path/" --exclude "payloads/*"

	mapfile -t payload_paths < <(manifest_payload_paths "$manifest_path")
	[[ "${#payload_paths[@]}" -gt 0 ]] || return

	include_args=(--exclude "*")
	for payload_path in "${payload_paths[@]}"; do
		if [[ "$payload_path" == "$payload_prefix"* ]]; then
			relative_path="${payload_path#"$payload_prefix"}"
			include_args+=(--include "$relative_path")
		else
			has_outside_payload_root=true
			break
		fi
	done

	if [[ "$has_outside_payload_root" == false ]]; then
		aws s3 sync "$artifact_root_uri/$payload_root/" "$dest/$payload_root/" "${include_args[@]}"
		return
	fi

	for payload_path in "${payload_paths[@]}"; do
		mkdir -p "$dest/$(dirname "$payload_path")"
		aws s3 cp "$artifact_root_uri/$payload_path" "$dest/$payload_path"
	done
}

copy_public_file "status.json"
copy_public_file "manifests/index.json"
local_manifest_specs=()

if [[ -z "$run_id" ]]; then
	if [[ "$all_latest" == true ]]; then
		mapfile -t dataset_ids < <(all_latest_dataset_ids "$dest/manifests/index.json")
		[[ "${#dataset_ids[@]}" -gt 0 ]] || die "manifests/index.json has no latest datasets"
	fi

	for dataset_id in "${dataset_ids[@]}"; do
		IFS=$'\t' read -r selected_cycle selected_run_id payload_root < <(
			selected_latest_run "$dest/manifests/index.json" "$dataset_id"
		)
		copy_public_file "manifests/$dataset_id/latest.json"
		copy_optional_public_file "manifests/$dataset_id/cycles/$selected_cycle/current.json"
		copy_optional_public_file "manifests/$dataset_id/cycles/$selected_cycle/runs/$selected_run_id.json"
		local_manifest_specs+=("$dataset_id=$dest/manifests/$dataset_id/latest.json")
		sync_run_payloads "$dataset_id" "$selected_cycle" "$selected_run_id" "$payload_root" "$dest/manifests/$dataset_id/latest.json"
	done
else
	for dataset_id in "${dataset_ids[@]}"; do
		run_manifest_path="manifests/$dataset_id/cycles/$cycle/runs/$run_id.json"
		copy_public_file "$run_manifest_path"
		mkdir -p "$dest/manifests/$dataset_id/cycles/$cycle"
		cp "$dest/$run_manifest_path" "$dest/manifests/$dataset_id/latest.json"
		cp "$dest/$run_manifest_path" "$dest/manifests/$dataset_id/cycles/$cycle/current.json"
		payload_root="$(selected_manifest_run "$dest/$run_manifest_path" "$cycle" "$run_id")"
		local_manifest_specs+=("$dataset_id=$dest/$run_manifest_path")
		sync_run_payloads "$dataset_id" "$cycle" "$run_id" "$payload_root" "$dest/$run_manifest_path"
	done
fi

write_local_manifest_index "$dest/manifests/index.json" "${local_manifest_specs[@]}"
