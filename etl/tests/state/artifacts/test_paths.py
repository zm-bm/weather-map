from __future__ import annotations

from pathlib import Path

from weather_etl.state.artifacts.identity import ArtifactWorkItem
from weather_etl.state.artifacts.paths import ArtifactPaths

from tests.fixtures.artifacts import DEFAULT_PRODUCT_CONFIG_DIGEST, DEFAULT_RUN_ID


def test_payload_uri_parts_uses_shared_weather_payload_layout() -> None:
    paths = ArtifactPaths("file:///tmp/weather-map-artifacts")

    uri = paths.payload_uri_parts(
        dataset_id="gfs",
        cycle="2026041200",
        run_id=DEFAULT_RUN_ID,
        frame_id="003",
        artifact_id="wind10m_uv",
        dtype="int8",
    )

    assert uri == (
        "file:///tmp/weather-map-artifacts/"
        f"runs/gfs/2026041200/{DEFAULT_RUN_ID}/payloads/003/wind10m_uv.i8.bin"
    )


def test_payload_uri_delegates_to_explicit_parts_layout() -> None:
    paths = ArtifactPaths("file:///tmp/weather-map-artifacts")
    item = ArtifactWorkItem(
        dataset_id="gfs",
        cycle="2026041200",
        run_id=DEFAULT_RUN_ID,
        frame_id="003",
        artifact_id="wind10m_uv",
        source_uri="file:///dev/null",
        product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
    )

    uri = paths.payload_uri(item, dtype="int8")

    assert uri == (
        "file:///tmp/weather-map-artifacts/"
        f"runs/gfs/2026041200/{DEFAULT_RUN_ID}/payloads/003/wind10m_uv.i8.bin"
    )


def test_artifact_paths_normalizes_bare_local_root(tmp_path: Path) -> None:
    root = tmp_path / "weather map artifacts"
    paths = ArtifactPaths(str(root))

    uri = paths.run_metadata_uri(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID)

    assert uri == f"{root.as_uri()}/runs/gfs/2026041200/{DEFAULT_RUN_ID}/run.json"


def test_validation_report_uri_is_run_scoped() -> None:
    paths = ArtifactPaths("file:///tmp/weather-map-artifacts")

    uri = paths.validation_report_uri(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID)

    assert uri == (
        "file:///tmp/weather-map-artifacts/"
        f"runs/gfs/2026041200/{DEFAULT_RUN_ID}/validation.json"
    )


def test_public_manifest_paths() -> None:
    paths = ArtifactPaths("file:///tmp/weather-map-artifacts")

    assert (
        paths.public_run_manifest_key(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID)
        == f"manifests/gfs/cycles/2026041200/runs/{DEFAULT_RUN_ID}.json"
    )
    assert paths.public_run_manifest_uri(dataset_id="gfs", cycle="2026041200", run_id=DEFAULT_RUN_ID) == (
        "file:///tmp/weather-map-artifacts/"
        f"manifests/gfs/cycles/2026041200/runs/{DEFAULT_RUN_ID}.json"
    )
    assert (
        paths.cycle_current_manifest_uri(dataset_id="gfs", cycle="2026041200")
        == "file:///tmp/weather-map-artifacts/manifests/gfs/cycles/2026041200/current.json"
    )
    assert paths.latest_manifest_uri(dataset_id="gfs") == "file:///tmp/weather-map-artifacts/manifests/gfs/latest.json"


def test_status_document_uri_is_root_scoped() -> None:
    paths = ArtifactPaths("file:///tmp/weather-map-artifacts")

    assert paths.status_uri() == "file:///tmp/weather-map-artifacts/status.json"
