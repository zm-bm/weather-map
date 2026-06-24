from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.scripts import SyncArtifactsScriptHarness, sync_artifacts_script_harness

ARTIFACT_ROOT = "s3://artifacts-bucket/weather"


@pytest.fixture
def script(repo_root: Path, tmp_path: Path) -> SyncArtifactsScriptHarness:
    return sync_artifacts_script_harness(repo_root, tmp_path)


def test_requires_s3_artifact_root(script: SyncArtifactsScriptHarness) -> None:
    missing = script.run()
    assert missing.returncode == 2
    assert "--artifact-root-uri is required" in missing.stderr

    non_s3 = script.run("--artifact-root-uri", "file:///artifacts")
    assert non_s3.returncode == 2
    assert "--artifact-root-uri must be an s3:// URI" in non_s3.stderr


def test_fetches_latest_gfs_by_default(script: SyncArtifactsScriptHarness, tmp_path: Path) -> None:
    dest = tmp_path / "artifacts"
    cycle = "2026051100"
    objects = fake_objects(
        latest_runs={
            "gfs": manifest(dataset_id="gfs", cycle=cycle, run_id=DEFAULT_RUN_ID),
            "icon": manifest(dataset_id="icon", cycle=cycle, run_id="20260511T120000Z-icon"),
        }
    )

    result = script.run(
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--dest",
        dest.as_posix(),
        env_overrides={"FAKE_AWS_OBJECTS_JSON": json.dumps(objects)},
    )

    assert result.returncode == 0
    log = script.aws_log()
    for relative_path in (
        "status.json",
        "manifests/index.json",
        "manifests/gfs/latest.json",
        f"manifests/gfs/cycles/{cycle}/current.json",
        f"manifests/gfs/cycles/{cycle}/runs/{DEFAULT_RUN_ID}.json",
    ):
        assert f"s3 cp {ARTIFACT_ROOT}/{relative_path} {dest.as_posix()}/{relative_path}" in log
    assert (
        "s3 sync "
        f"{ARTIFACT_ROOT}/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/ "
        f"{dest.as_posix()}/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/ "
        "--exclude payloads/\\*"
    ) in log
    assert (
        "s3 sync "
        f"{ARTIFACT_ROOT}/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/payloads/ "
        f"{dest.as_posix()}/runs/gfs/{cycle}/{DEFAULT_RUN_ID}/payloads/ "
        "--exclude \\* --include 000/tmp_surface.i8.bin"
    ) in log
    assert f"{ARTIFACT_ROOT}/runs/icon/{cycle}/20260511T120000Z-icon/payloads/" not in log

    local_index = json.loads((dest / "manifests/index.json").read_text(encoding="utf-8"))
    assert list(local_index["datasets"]) == ["gfs"]
    assert local_index["datasets"]["gfs"]["latest"]["run"]["run_id"] == DEFAULT_RUN_ID
    latest_artifact = local_index["datasets"]["gfs"]["latest"]["artifacts"]["tmp_surface"]
    assert latest_artifact["byte_length"] == 4
    assert "frames" not in latest_artifact


def test_run_id_requires_cycle(script: SyncArtifactsScriptHarness) -> None:
    result = script.run(
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--dataset-id",
        "gfs",
        "--run-id",
        DEFAULT_RUN_ID,
    )

    assert result.returncode == 2
    assert "--cycle is required when --run-id is provided" in result.stderr


def test_fetches_explicit_run_manifest_and_payload_root(
    script: SyncArtifactsScriptHarness,
    tmp_path: Path,
) -> None:
    dest = tmp_path / "artifacts"
    cycle = "2026051100"
    run_id = "20260511T120000Z-explicit"
    payload_root = "runs/gfs/custom-payload-root/payloads"
    objects = fake_objects(
        latest_runs={
            "gfs": manifest(dataset_id="gfs", cycle="2026051112", run_id=DEFAULT_RUN_ID),
        },
        run_manifests={
            ("gfs", cycle, run_id): manifest(
                dataset_id="gfs",
                cycle=cycle,
                run_id=run_id,
                payload_root=payload_root,
            ),
        },
    )

    result = script.run(
        "--artifact-root-uri",
        f"{ARTIFACT_ROOT}/",
        "--dataset-id",
        "gfs",
        "--cycle",
        cycle,
        "--run-id",
        run_id,
        "--dest",
        dest.as_posix(),
        env_overrides={"FAKE_AWS_OBJECTS_JSON": json.dumps(objects)},
    )

    assert result.returncode == 0
    log = script.aws_log()
    assert (
        f"s3 cp {ARTIFACT_ROOT}/manifests/gfs/cycles/{cycle}/runs/{run_id}.json "
        f"{dest.as_posix()}/manifests/gfs/cycles/{cycle}/runs/{run_id}.json"
    ) in log
    assert (
        "s3 sync "
        f"{ARTIFACT_ROOT}/runs/gfs/{cycle}/{run_id}/ "
        f"{dest.as_posix()}/runs/gfs/{cycle}/{run_id}/ "
        "--exclude payloads/\\*"
    ) in log
    assert (
        "s3 sync "
        f"{ARTIFACT_ROOT}/{payload_root}/ "
        f"{dest.as_posix()}/{payload_root}/ "
        "--exclude \\* --include 000/tmp_surface.i8.bin"
    ) in log

    local_index = json.loads((dest / "manifests/index.json").read_text(encoding="utf-8"))
    assert list(local_index["datasets"]) == ["gfs"]
    assert local_index["datasets"]["gfs"]["latest"]["run"]["run_id"] == run_id
    latest_artifact = local_index["datasets"]["gfs"]["latest"]["artifacts"]["tmp_surface"]
    assert latest_artifact["byte_length"] == 4
    assert "frames" not in latest_artifact
    assert json.loads((dest / "manifests/gfs/latest.json").read_text(encoding="utf-8"))["run"]["run_id"] == run_id
    assert json.loads(
        (dest / f"manifests/gfs/cycles/{cycle}/current.json").read_text(encoding="utf-8")
    )["run"]["run_id"] == run_id


def test_all_fetches_every_latest_dataset(script: SyncArtifactsScriptHarness, tmp_path: Path) -> None:
    dest = tmp_path / "artifacts"
    gfs_run_id = "20260511T120000Z-gfs"
    icon_run_id = "20260511T120000Z-icon"
    objects = fake_objects(
        latest_runs={
            "gfs": manifest(dataset_id="gfs", cycle="2026051112", run_id=gfs_run_id),
            "icon": manifest(dataset_id="icon", cycle="2026051112", run_id=icon_run_id),
        }
    )

    result = script.run(
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--all",
        "--dest",
        dest.as_posix(),
        env_overrides={"FAKE_AWS_OBJECTS_JSON": json.dumps(objects)},
    )

    assert result.returncode == 0
    log = script.aws_log()
    assert (
        f"{ARTIFACT_ROOT}/runs/gfs/2026051112/{gfs_run_id}/payloads/ "
        f"{dest.as_posix()}/runs/gfs/2026051112/{gfs_run_id}/payloads/ "
        "--exclude \\* --include 000/tmp_surface.i8.bin"
    ) in log
    assert (
        f"{ARTIFACT_ROOT}/runs/icon/2026051112/{icon_run_id}/payloads/ "
        f"{dest.as_posix()}/runs/icon/2026051112/{icon_run_id}/payloads/ "
        "--exclude \\* --include 000/tmp_surface.i8.bin"
    ) in log
    local_index = json.loads((dest / "manifests/index.json").read_text(encoding="utf-8"))
    assert list(local_index["datasets"]) == ["gfs", "icon"]


def test_latest_all_tolerates_missing_rolling_current_manifest(
    script: SyncArtifactsScriptHarness,
    tmp_path: Path,
) -> None:
    dest = tmp_path / "artifacts"
    run_id = "20260624T145839Z-bca624e0"
    objects = fake_objects(
        latest_runs={
            "mrms": manifest(
                dataset_id="mrms",
                cycle="2026062414",
                run_id=run_id,
                payload_root="runs/mrms/rolling/payloads",
                artifact_id="observed_radar_composite_reflectivity",
            ),
        },
        omit_current_for={"mrms"},
    )

    result = script.run(
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--all",
        "--dest",
        dest.as_posix(),
        env_overrides={"FAKE_AWS_OBJECTS_JSON": json.dumps(objects)},
    )

    assert result.returncode == 0
    assert "optional public file not copied: manifests/mrms/cycles/2026062414/current.json" in result.stderr
    log = script.aws_log()
    assert (
        f"s3 sync {ARTIFACT_ROOT}/runs/mrms/rolling/payloads/ "
        f"{dest.as_posix()}/runs/mrms/rolling/payloads/ "
        "--exclude \\* --include 000/observed_radar_composite_reflectivity.i8.bin"
    ) in log
    assert f"s3 cp {ARTIFACT_ROOT}/runs/mrms/rolling/payloads/" not in log
    local_index = json.loads((dest / "manifests/index.json").read_text(encoding="utf-8"))
    assert list(local_index["datasets"]) == ["mrms"]
    assert local_index["datasets"]["mrms"]["latest"]["run"]["payload_root"] == "runs/mrms/rolling/payloads"
    latest_artifact = local_index["datasets"]["mrms"]["latest"]["artifacts"][
        "observed_radar_composite_reflectivity"
    ]
    assert latest_artifact["byte_length"] == 4
    assert "frames" not in latest_artifact


def test_all_is_rejected_with_run_id(script: SyncArtifactsScriptHarness) -> None:
    result = script.run(
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--all",
        "--cycle",
        "2026051100",
        "--run-id",
        DEFAULT_RUN_ID,
    )

    assert result.returncode == 2
    assert "--all cannot be used with --run-id" in result.stderr


def test_include_public_flag_is_accepted_for_old_commands(
    script: SyncArtifactsScriptHarness,
    tmp_path: Path,
) -> None:
    dest = tmp_path / "artifacts"
    objects = fake_objects(
        latest_runs={
            "gfs": manifest(dataset_id="gfs", cycle="2026051112", run_id=DEFAULT_RUN_ID),
        }
    )

    result = script.run(
        "--artifact-root-uri",
        ARTIFACT_ROOT,
        "--dataset-id",
        "gfs",
        "--cycle",
        "2026051112",
        "--run-id",
        DEFAULT_RUN_ID,
        "--dest",
        dest.as_posix(),
        "--include-public",
        env_overrides={"FAKE_AWS_OBJECTS_JSON": json.dumps(objects)},
    )

    assert result.returncode == 0


def manifest(
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
    payload_root: str | None = None,
    artifact_id: str = "tmp_surface",
) -> dict:
    payload_root = payload_root or f"runs/{dataset_id}/{cycle}/{run_id}/payloads"
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
        "artifacts": {
            artifact_id: {
                "id": artifact_id,
                "frames": {
                    "000": {
                        "path": f"{payload_root}/000/{artifact_id}.i8.bin",
                        "byte_length": 4,
                    },
                },
            },
        },
        "payload_contract": "field-binary-v2",
    }


def fake_objects(
    *,
    latest_runs: dict[str, dict],
    run_manifests: dict[tuple[str, str, str], dict] | None = None,
    omit_current_for: set[str] | None = None,
) -> dict[str, dict | str]:
    objects: dict[str, dict | str] = {
        f"{ARTIFACT_ROOT}/status.json": {
            "schema": "weather-map.etl-status",
            "schema_version": 1,
            "datasets": [],
        },
        f"{ARTIFACT_ROOT}/manifests/index.json": {
            "schema": "weather-map.manifest-index",
            "schema_version": 1,
            "datasets": {
                dataset_id: {
                    "label": dataset_id.upper(),
                    "latest": compact_latest(latest),
                }
                for dataset_id, latest in latest_runs.items()
            },
            "layers": {},
            "payload_contract": "field-binary-v2",
        },
    }
    for dataset_id, latest in latest_runs.items():
        cycle = latest["run"]["cycle"]
        run_id = latest["run"]["run_id"]
        objects[f"{ARTIFACT_ROOT}/manifests/{dataset_id}/latest.json"] = latest
        if dataset_id not in (omit_current_for or set()):
            objects[f"{ARTIFACT_ROOT}/manifests/{dataset_id}/cycles/{cycle}/current.json"] = latest
        objects[f"{ARTIFACT_ROOT}/manifests/{dataset_id}/cycles/{cycle}/runs/{run_id}.json"] = latest
        add_payload_objects(objects, latest)

    for (dataset_id, cycle, run_id), run_manifest in (run_manifests or {}).items():
        objects[f"{ARTIFACT_ROOT}/manifests/{dataset_id}/cycles/{cycle}/current.json"] = run_manifest
        objects[f"{ARTIFACT_ROOT}/manifests/{dataset_id}/cycles/{cycle}/runs/{run_id}.json"] = run_manifest
        add_payload_objects(objects, run_manifest)

    return objects


def compact_latest(manifest: dict) -> dict:
    frame_ids = [frame["id"] for frame in manifest["frames"]]
    return {
        "run": manifest["run"],
        "frames": manifest["frames"],
        "artifacts": {
            artifact_id: compact_artifact(artifact, frame_ids)
            for artifact_id, artifact in manifest["artifacts"].items()
        },
    }


def compact_artifact(artifact: dict, frame_ids: list[str]) -> dict:
    byte_length = artifact["frames"][frame_ids[0]]["byte_length"]
    return {
        **{key: value for key, value in artifact.items() if key != "frames"},
        "byte_length": byte_length,
    }


def add_payload_objects(objects: dict[str, dict | str], manifest: dict) -> None:
    for artifact in manifest["artifacts"].values():
        for frame in artifact["frames"].values():
            objects[f"{ARTIFACT_ROOT}/{frame['path']}"] = "payload"
