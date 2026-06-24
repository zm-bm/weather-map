#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sync = ArtifactSync(args)
    sync.run()
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch published ETL run artifacts into the local artifacts tree.",
    )
    parser.add_argument("--artifact-root-uri", default=os.environ.get("ARTIFACT_ROOT_URI", ""))
    parser.add_argument("--dataset-id", action="append", default=[])
    parser.add_argument("--cycle", default=os.environ.get("CYCLE", ""))
    parser.add_argument("--run-id", default=os.environ.get("RUN_ID", ""))
    parser.add_argument("--dest", default=os.environ.get("DEST", "artifacts"))
    parser.add_argument("--all", action="store_true", dest="all_latest")
    parser.add_argument(
        "--include-public",
        action="store_true",
        help=argparse.SUPPRESS,
    )

    args = parser.parse_args(argv)
    if not args.artifact_root_uri:
        parser.error("--artifact-root-uri is required")
    if not args.artifact_root_uri.startswith("s3://"):
        parser.error("--artifact-root-uri must be an s3:// URI")
    if args.all_latest and args.run_id:
        parser.error("--all cannot be used with --run-id")
    if args.run_id and not args.cycle:
        parser.error("--cycle is required when --run-id is provided")
    if args.cycle and not args.run_id:
        parser.error("--run-id is required when --cycle is provided")
    if args.all_latest and args.dataset_id:
        parser.error("--all cannot be combined with --dataset-id")

    if not args.dataset_id and not args.all_latest:
        args.dataset_id = [os.environ.get("DATASET_ID", "gfs")]
    for dataset_id in args.dataset_id:
        if not dataset_id:
            parser.error("--dataset-id must not be empty")

    args.artifact_root_uri = args.artifact_root_uri.rstrip("/")
    args.dest = args.dest.rstrip("/")
    return args


class ArtifactSync:
    def __init__(self, args: argparse.Namespace) -> None:
        self.artifact_root_uri: str = args.artifact_root_uri
        self.dataset_ids: list[str] = list(args.dataset_id)
        self.cycle: str = args.cycle
        self.run_id: str = args.run_id
        self.dest = Path(args.dest)
        self.all_latest: bool = args.all_latest

    def run(self) -> None:
        self.copy_public_file("status.json")
        self.copy_public_file("manifests/index.json")
        local_manifest_specs: list[tuple[str, Path]] = []

        if not self.run_id:
            if self.all_latest:
                self.dataset_ids = all_latest_dataset_ids(read_json(self.dest / "manifests/index.json"))
                if not self.dataset_ids:
                    raise SystemExit("manifests/index.json has no latest datasets")

            for dataset_id in self.dataset_ids:
                selected = selected_latest_run(self.dest / "manifests/index.json", dataset_id)
                latest_manifest_path = Path("manifests") / dataset_id / "latest.json"
                self.copy_public_file(latest_manifest_path.as_posix())
                self.copy_optional_public_file(f"manifests/{dataset_id}/cycles/{selected.cycle}/current.json")
                self.copy_optional_public_file(
                    f"manifests/{dataset_id}/cycles/{selected.cycle}/runs/{selected.run_id}.json"
                )
                local_manifest = self.dest / latest_manifest_path
                local_manifest_specs.append((dataset_id, local_manifest))
                self.sync_run_payloads(
                    dataset_id=dataset_id,
                    selected_cycle=selected.cycle,
                    selected_run_id=selected.run_id,
                    payload_root=selected.payload_root,
                    manifest_path=local_manifest,
                )
        else:
            for dataset_id in self.dataset_ids:
                run_manifest_path = (
                    Path("manifests")
                    / dataset_id
                    / "cycles"
                    / self.cycle
                    / "runs"
                    / f"{self.run_id}.json"
                )
                self.copy_public_file(run_manifest_path.as_posix())
                local_run_manifest = self.dest / run_manifest_path
                latest_manifest = self.dest / "manifests" / dataset_id / "latest.json"
                current_manifest = self.dest / "manifests" / dataset_id / "cycles" / self.cycle / "current.json"
                latest_manifest.parent.mkdir(parents=True, exist_ok=True)
                current_manifest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(local_run_manifest, latest_manifest)
                shutil.copyfile(local_run_manifest, current_manifest)
                payload_root = selected_manifest_payload_root(local_run_manifest, self.cycle, self.run_id)
                local_manifest_specs.append((dataset_id, local_run_manifest))
                self.sync_run_payloads(
                    dataset_id=dataset_id,
                    selected_cycle=self.cycle,
                    selected_run_id=self.run_id,
                    payload_root=payload_root,
                    manifest_path=local_run_manifest,
                )

        write_local_manifest_index(self.dest / "manifests/index.json", local_manifest_specs)

    def copy_public_file(self, relative_path: str) -> None:
        destination = self.dest / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        run_aws(["s3", "cp", f"{self.artifact_root_uri}/{relative_path}", destination.as_posix()])

    def copy_optional_public_file(self, relative_path: str) -> None:
        destination = self.dest / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            run_aws(["s3", "cp", f"{self.artifact_root_uri}/{relative_path}", destination.as_posix()])
        except subprocess.CalledProcessError:
            print(f"warning: optional public file not copied: {relative_path}", file=sys.stderr)

    def sync_run_payloads(
        self,
        *,
        dataset_id: str,
        selected_cycle: str,
        selected_run_id: str,
        payload_root: str,
        manifest_path: Path,
    ) -> None:
        run_path = f"runs/{dataset_id}/{selected_cycle}/{selected_run_id}"
        print(f"Fetching ETL run {dataset_id}/{selected_cycle}/{selected_run_id}")
        print(f"  payload_root: {payload_root}")
        (self.dest / run_path).mkdir(parents=True, exist_ok=True)
        (self.dest / payload_root).mkdir(parents=True, exist_ok=True)
        run_aws([
            "s3",
            "sync",
            f"{self.artifact_root_uri}/{run_path}/",
            f"{(self.dest / run_path).as_posix()}/",
            "--exclude",
            "payloads/*",
        ])

        payload_paths = manifest_payload_paths(manifest_path)
        if not payload_paths:
            return

        payload_sync = select_payload_sync(payload_root=payload_root, payload_paths=payload_paths)
        if payload_sync.use_filtered_sync:
            run_aws([
                "s3",
                "sync",
                f"{self.artifact_root_uri}/{payload_root}/",
                f"{(self.dest / payload_root).as_posix()}/",
                *payload_sync.include_args,
            ])
            return

        for payload_path in payload_sync.payload_paths:
            destination = self.dest / payload_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            run_aws(["s3", "cp", f"{self.artifact_root_uri}/{payload_path}", destination.as_posix()])


@dataclass(frozen=True)
class SelectedRun:
    cycle: str
    run_id: str
    payload_root: str


@dataclass(frozen=True)
class PayloadSyncSelection:
    use_filtered_sync: bool
    include_args: tuple[str, ...] = ()
    payload_paths: tuple[str, ...] = ()


def selected_latest_run(index_path: Path, dataset_id: str) -> SelectedRun:
    return selected_latest_run_from_index(read_json(index_path), dataset_id)


def selected_latest_run_from_index(index: dict[str, Any], dataset_id: str) -> SelectedRun:
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
    return SelectedRun(cycle=cycle, run_id=run_id, payload_root=payload_root)


def all_latest_dataset_ids(index: dict[str, Any]) -> list[str]:
    datasets = index.get("datasets")
    if not isinstance(datasets, dict):
        raise SystemExit("manifest index datasets must be an object")
    return [
        dataset_id
        for dataset_id, dataset in datasets.items()
        if isinstance(dataset, dict) and dataset.get("latest") is not None
    ]


def selected_manifest_payload_root(manifest_path: Path, expected_cycle: str, expected_run_id: str) -> str:
    return selected_manifest_run(read_json(manifest_path), expected_cycle, expected_run_id).payload_root


def selected_manifest_run(manifest: dict[str, Any], expected_cycle: str, expected_run_id: str) -> SelectedRun:
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
    return SelectedRun(cycle=cycle, run_id=run_id, payload_root=payload_root)


def manifest_payload_paths(manifest_path: Path) -> list[str]:
    return manifest_payload_paths_from_manifest(read_json(manifest_path))


def manifest_payload_paths_from_manifest(manifest: dict[str, Any]) -> list[str]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise SystemExit("manifest artifacts must be an object")

    paths = set()
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
    return sorted(paths)


def select_payload_sync(*, payload_root: str, payload_paths: list[str]) -> PayloadSyncSelection:
    payload_prefix = f"{payload_root.rstrip('/')}/"
    include_args: list[str] = ["--exclude", "*"]
    for payload_path in payload_paths:
        if not payload_path.startswith(payload_prefix):
            return PayloadSyncSelection(
                use_filtered_sync=False,
                payload_paths=tuple(payload_paths),
            )
        include_args.extend(["--include", payload_path.removeprefix(payload_prefix)])
    return PayloadSyncSelection(
        use_filtered_sync=True,
        include_args=tuple(include_args),
    )


def write_local_manifest_index(index_path: Path, specs: list[tuple[str, Path]]) -> None:
    index = read_json(index_path)
    manifest_specs = [
        (dataset_id, read_json(manifest_path))
        for dataset_id, manifest_path in specs
    ]
    write_json(index_path, build_local_manifest_index(index, manifest_specs))


def build_local_manifest_index(
    index: dict[str, Any],
    specs: list[tuple[str, dict[str, Any]]],
) -> dict[str, Any]:
    local_index = copy.deepcopy(index)
    source_datasets = index.get("datasets")
    if not isinstance(source_datasets, dict):
        raise SystemExit("manifest index datasets must be an object")

    selected_dataset_ids = set()
    selected_datasets = {}
    for dataset_id, manifest in specs:
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

    local_index["datasets"] = selected_datasets
    layers = local_index.get("layers")
    if isinstance(layers, dict):
        for layer in layers.values():
            layer_datasets = layer.get("datasets") if isinstance(layer, dict) else None
            if isinstance(layer_datasets, dict):
                layer["datasets"] = {
                    dataset_id: value
                    for dataset_id, value in layer_datasets.items()
                    if dataset_id in selected_dataset_ids
                }

    return local_index


def compact_latest(manifest: dict[str, Any]) -> dict[str, Any]:
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


def compact_artifact(artifact_id: str, artifact: object, frame_ids: list[str]) -> dict[str, Any]:
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


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        value = json.load(fh)
    if not isinstance(value, dict):
        raise SystemExit(f"{path} must contain a JSON object")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def run_aws(args: list[str]) -> None:
    subprocess.run(["aws", *args], check=True)


if __name__ == "__main__":
    raise SystemExit(main())
