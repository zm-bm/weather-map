from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID

ARTIFACT_ROOT = "s3://artifacts-bucket/weather"


@pytest.fixture
def sync_module(repo_root: Path) -> ModuleType:
    module_path = repo_root / "scripts" / "etl-sync-artifacts.py"
    spec = importlib.util.spec_from_file_location("etl_sync_artifacts", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_parse_args_selects_default_and_explicit_datasets(
    sync_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATASET_ID", raising=False)

    default_args = sync_module.parse_args(["--artifact-root-uri", ARTIFACT_ROOT])
    explicit_args = sync_module.parse_args([
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--dataset-id",
        "gfs",
        "--dataset-id",
        "mrms",
    ])

    assert default_args.dataset_id == ["gfs"]
    assert explicit_args.dataset_id == ["gfs", "mrms"]


def test_parse_args_rejects_invalid_selection(sync_module: ModuleType) -> None:
    with pytest.raises(SystemExit):
        sync_module.parse_args([])
    with pytest.raises(SystemExit):
        sync_module.parse_args(["--artifact-root-uri", "file:///artifacts"])
    with pytest.raises(SystemExit):
        sync_module.parse_args(["--artifact-root-uri", ARTIFACT_ROOT, "--run-id", DEFAULT_RUN_ID])
    with pytest.raises(SystemExit):
        sync_module.parse_args([
            "--artifact-root-uri",
            ARTIFACT_ROOT,
            "--all",
            "--dataset-id",
            "gfs",
        ])


def test_all_latest_dataset_ids_preserve_index_order(sync_module: ModuleType) -> None:
    index = fake_index({
        "gfs": manifest(dataset_id="gfs", cycle="2026051100", run_id="gfs-run"),
        "icon": manifest(dataset_id="icon", cycle="2026051100", run_id="icon-run"),
        "mrms": None,
    })

    assert sync_module.all_latest_dataset_ids(index) == ["gfs", "icon"]


def test_selected_run_metadata_from_latest_index(sync_module: ModuleType) -> None:
    latest = manifest(dataset_id="gfs", cycle="2026051100", run_id=DEFAULT_RUN_ID)
    selected = sync_module.selected_latest_run_from_index(fake_index({"gfs": latest}), "gfs")

    assert selected.cycle == "2026051100"
    assert selected.run_id == DEFAULT_RUN_ID
    assert selected.payload_root == f"runs/gfs/2026051100/{DEFAULT_RUN_ID}/payloads"


def test_explicit_run_manifest_validation(sync_module: ModuleType) -> None:
    run_manifest = manifest(dataset_id="gfs", cycle="2026051100", run_id=DEFAULT_RUN_ID)

    selected = sync_module.selected_manifest_run(run_manifest, "2026051100", DEFAULT_RUN_ID)

    assert selected.payload_root == f"runs/gfs/2026051100/{DEFAULT_RUN_ID}/payloads"
    with pytest.raises(SystemExit, match="cycle mismatch"):
        sync_module.selected_manifest_run(run_manifest, "2026051112", DEFAULT_RUN_ID)
    with pytest.raises(SystemExit, match="run_id mismatch"):
        sync_module.selected_manifest_run(run_manifest, "2026051100", "different-run")


def test_manifest_payload_paths_are_sorted_and_deduped(sync_module: ModuleType) -> None:
    run_manifest = manifest(
        dataset_id="gfs",
        cycle="2026051100",
        run_id=DEFAULT_RUN_ID,
        artifact_frames={
            "tmp_surface": {
                "001": "runs/gfs/2026051100/run/payloads/001/tmp_surface.i8.bin",
                "000": "runs/gfs/2026051100/run/payloads/000/tmp_surface.i8.bin",
            },
            "dewpoint_surface": {
                "000": "runs/gfs/2026051100/run/payloads/000/tmp_surface.i8.bin",
            },
        },
    )

    assert sync_module.manifest_payload_paths_from_manifest(run_manifest) == [
        "runs/gfs/2026051100/run/payloads/000/tmp_surface.i8.bin",
        "runs/gfs/2026051100/run/payloads/001/tmp_surface.i8.bin",
    ]


def test_compact_latest_and_local_index_shape(sync_module: ModuleType) -> None:
    latest = manifest(dataset_id="gfs", cycle="2026051100", run_id=DEFAULT_RUN_ID)
    source_index = fake_index({
        "gfs": latest,
        "icon": manifest(dataset_id="icon", cycle="2026051100", run_id="icon-run"),
    })
    source_index["layers"] = {
        "temperature": {
            "datasets": {
                "gfs": {"support": "native"},
                "icon": {"support": "native"},
            },
        },
    }

    compact = sync_module.compact_latest(latest)
    local_index = sync_module.build_local_manifest_index(source_index, [("gfs", latest)])

    assert compact["artifacts"]["tmp_surface"]["byte_length"] == 4
    assert "frames" not in compact["artifacts"]["tmp_surface"]
    assert list(local_index["datasets"]) == ["gfs"]
    assert local_index["layers"]["temperature"]["datasets"] == {"gfs": {"support": "native"}}
    assert local_index["datasets"]["gfs"]["latest"]["artifacts"]["tmp_surface"]["byte_length"] == 4
    assert "frames" not in local_index["datasets"]["gfs"]["latest"]["artifacts"]["tmp_surface"]


def test_payload_sync_selection_uses_filtered_sync_include_paths(sync_module: ModuleType) -> None:
    selection = sync_module.select_payload_sync(
        payload_root="runs/gfs/2026051100/run/payloads",
        payload_paths=[
            "runs/gfs/2026051100/run/payloads/000/tmp_surface.i8.bin",
            "runs/gfs/2026051100/run/payloads/003/tmp_surface.i8.bin",
        ],
    )

    assert selection.use_filtered_sync is True
    assert selection.include_args == (
        "--exclude",
        "*",
        "--include",
        "000/tmp_surface.i8.bin",
        "--include",
        "003/tmp_surface.i8.bin",
    )
    assert selection.payload_paths == ()


def test_payload_sync_selection_falls_back_for_paths_outside_payload_root(sync_module: ModuleType) -> None:
    selection = sync_module.select_payload_sync(
        payload_root="runs/gfs/custom-root/payloads",
        payload_paths=[
            "runs/gfs/custom-root/payloads/000/tmp_surface.i8.bin",
            "runs/gfs/other-root/payloads/000/tmp_surface.i8.bin",
        ],
    )

    assert selection.use_filtered_sync is False
    assert selection.include_args == ()
    assert selection.payload_paths == (
        "runs/gfs/custom-root/payloads/000/tmp_surface.i8.bin",
        "runs/gfs/other-root/payloads/000/tmp_surface.i8.bin",
    )


def test_mrms_rolling_payload_root_uses_filtered_sync(sync_module: ModuleType) -> None:
    selection = sync_module.select_payload_sync(
        payload_root="runs/mrms/rolling/payloads",
        payload_paths=[
            "runs/mrms/rolling/payloads/20260624134040/observed_radar_composite_reflectivity.i8.bin",
        ],
    )

    assert selection.use_filtered_sync is True
    assert selection.include_args == (
        "--exclude",
        "*",
        "--include",
        "20260624134040/observed_radar_composite_reflectivity.i8.bin",
    )


def test_explicit_run_synthesizes_latest_current_and_local_index(
    sync_module: ModuleType,
    tmp_path: Path,
) -> None:
    dest = tmp_path / "artifacts"
    cycle = "2026051100"
    run_id = "20260511T120000Z-explicit"
    run_manifest = manifest(dataset_id="gfs", cycle=cycle, run_id=run_id)
    remote_objects = {
        "status.json": {"schema": "weather-map.etl-status", "schema_version": 1, "datasets": []},
        "manifests/index.json": fake_index({
            "gfs": manifest(dataset_id="gfs", cycle="2026051112", run_id=DEFAULT_RUN_ID),
        }),
        f"manifests/gfs/cycles/{cycle}/runs/{run_id}.json": run_manifest,
    }
    sync = sync_module.ArtifactSync(
        sync_module.parse_args([
            "--artifact-root-uri",
            ARTIFACT_ROOT,
            "--dataset-id",
            "gfs",
            "--cycle",
            cycle,
            "--run-id",
            run_id,
            "--dest",
            dest.as_posix(),
        ])
    )
    sync.copy_public_file = lambda relative_path: write_json(dest / relative_path, remote_objects[relative_path])
    sync_calls = []
    sync.sync_run_payloads = lambda **kwargs: sync_calls.append(kwargs)

    sync.run()

    latest = read_json(dest / "manifests/gfs/latest.json")
    current = read_json(dest / f"manifests/gfs/cycles/{cycle}/current.json")
    local_index = read_json(dest / "manifests/index.json")
    assert latest["run"]["run_id"] == run_id
    assert current["run"]["run_id"] == run_id
    assert local_index["datasets"]["gfs"]["latest"]["run"]["run_id"] == run_id
    assert local_index["datasets"]["gfs"]["latest"]["artifacts"]["tmp_surface"]["byte_length"] == 4
    assert "frames" not in local_index["datasets"]["gfs"]["latest"]["artifacts"]["tmp_surface"]
    assert sync_calls[0]["payload_root"] == f"runs/gfs/{cycle}/{run_id}/payloads"


def manifest(
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
    payload_root: str | None = None,
    artifact_id: str = "tmp_surface",
    artifact_frames: dict[str, dict[str, str]] | None = None,
) -> dict:
    payload_root = payload_root or f"runs/{dataset_id}/{cycle}/{run_id}/payloads"
    artifacts = {
        artifact_id: {
            "id": artifact_id,
            "frames": {
                "000": {
                    "path": f"{payload_root}/000/{artifact_id}.i8.bin",
                    "byte_length": 4,
                },
            },
        },
    }
    if artifact_frames is not None:
        artifacts = {
            artifact: {
                "id": artifact,
                "frames": {
                    frame_id: {
                        "path": path,
                        "byte_length": 4,
                    }
                    for frame_id, path in frames.items()
                },
            }
            for artifact, frames in artifact_frames.items()
        }

    return {
        "schema": "weather-map.cycle-manifest",
        "schema_version": 1,
        "dataset": {"id": dataset_id, "label": dataset_id.upper()},
        "run": {
            "cycle": cycle,
            "run_id": run_id,
            "payload_root": payload_root,
            "generated_at": "2026-05-11T12:00:00Z",
            "revision": f"{dataset_id}-revision",
        },
        "frames": [{"id": "000"}],
        "artifacts": artifacts,
        "payload_contract": "field-binary-v2",
    }


def fake_index(latest_runs: dict[str, dict | None]) -> dict:
    return {
        "schema": "weather-map.manifest-index",
        "schema_version": 1,
        "datasets": {
            dataset_id: {
                "label": dataset_id.upper(),
                "latest": None if latest is None else compact_latest_for_test(latest),
            }
            for dataset_id, latest in latest_runs.items()
        },
        "layers": {},
        "payload_contract": "field-binary-v2",
    }


def compact_latest_for_test(run_manifest: dict) -> dict:
    return {
        "run": run_manifest["run"],
        "frames": run_manifest["frames"],
        "artifacts": {
            artifact_id: {
                **{key: value for key, value in artifact.items() if key != "frames"},
                "byte_length": next(iter(artifact["frames"].values()))["byte_length"],
            }
            for artifact_id, artifact in run_manifest["artifacts"].items()
        },
    }


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
