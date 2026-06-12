from __future__ import annotations

import gzip
import hashlib
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from weather_etl.config.pipeline import PipelineConfig, parse_pipeline_config
from weather_etl.config.product import LoadedProductConfig
from weather_etl.config.sources import MRMS_AWS_S3_SOURCE_TYPE
from weather_etl.state.artifacts.publication_schema import run_publication_marker_dict
from weather_etl.state.artifacts.repository import PAYLOAD_METADATA, ArtifactRepository
from weather_etl.state.manifest.rolling_observed import publish_rolling_observed_latest
from weather_etl.state.manifest.schema import parse_cycle_manifest
from weather_etl.storage.routing import make_store
from weather_etl.storage.uris import join_uri

from tests.fixtures.manifests import cycle_manifest_dict
from tests.fixtures.pipeline import loaded_product_config, raw_pipeline_config


def _repo(root: Path) -> ArtifactRepository:
    return ArtifactRepository.for_root(store=make_store(), artifact_root_uri=root.as_uri())


def _pipeline_config() -> PipelineConfig:
    raw = raw_pipeline_config(
        dataset_ids=("mrms",),
        source_types={"mrms": MRMS_AWS_S3_SOURCE_TYPE},
        artifacts=("tmp_surface",),
    )
    raw["datasets"]["mrms"]["label"] = "MRMS"
    raw["datasets"]["mrms"]["lifecycle"] = {
        "type": "rolling_observed",
        "display_window_minutes": 120,
        "publish_scan_minutes": 180,
    }
    return parse_pipeline_config(raw)


def _product_config() -> LoadedProductConfig:
    return loaded_product_config(
        dataset_id="mrms",
        pipeline_config=_pipeline_config(),
    )


def _payload_bytes(*, frame_id: str, run_id: str, revision_suffix: str = "") -> bytes:
    return hashlib.sha256(f"{frame_id}:{run_id}:{revision_suffix}".encode("utf-8")).digest()[:4]


def _published_observed_manifest(
    product_config: LoadedProductConfig,
    *,
    frame_id: str,
    valid_at: str,
    cycle: str,
    run_id: str,
    revision_suffix: str = "",
) -> dict[str, Any]:
    dataset = product_config.pipeline_config.dataset("mrms")
    manifest = cycle_manifest_dict(
        dataset,
        cycle=cycle,
        run_id=run_id,
        artifact_ids=("tmp_surface",),
        frames=("000",),
        generated_at=valid_at,
        revision=f"mrms-{frame_id}-revision{revision_suffix}",
    )
    manifest["frames"] = [{
        "id": frame_id,
        "lead_hours": 0,
        "valid_at": valid_at,
    }]
    artifact = deepcopy(manifest["artifacts"]["tmp_surface"])
    frame_payload = artifact["frames"]["000"]
    payload = _payload_bytes(frame_id=frame_id, run_id=run_id, revision_suffix=revision_suffix)
    frame_payload["path"] = f"runs/mrms/{cycle}/{run_id}/payloads/{frame_id}/tmp_surface.i16.bin"
    frame_payload["byte_length"] = len(payload)
    frame_payload["sha256"] = hashlib.sha256(payload).hexdigest()
    artifact["frames"] = {frame_id: frame_payload}
    manifest["artifacts"]["tmp_surface"] = artifact
    return manifest


def _write_published_manifest(
    repo: ArtifactRepository,
    product_config: LoadedProductConfig,
    *,
    frame_id: str,
    valid_at: str,
    cycle: str,
    run_id: str,
    revision_suffix: str = "",
    mutation: dict[str, Any] | None = None,
) -> None:
    manifest = _published_observed_manifest(
        product_config,
        frame_id=frame_id,
        valid_at=valid_at,
        cycle=cycle,
        run_id=run_id,
        revision_suffix=revision_suffix,
    )
    if mutation:
        manifest["artifacts"]["tmp_surface"].update(mutation)
    payload = _payload_bytes(frame_id=frame_id, run_id=run_id, revision_suffix=revision_suffix)
    source_path = manifest["artifacts"]["tmp_surface"]["frames"][frame_id]["path"]
    repo.store.write_bytes_with_metadata(
        uri=join_uri(repo.paths.artifact_root_uri, [source_path]),
        data=gzip.compress(payload, mtime=0),
        metadata=PAYLOAD_METADATA,
    )
    parsed = parse_cycle_manifest(manifest)
    public_uri = repo.write_public_run_manifest(dataset_id="mrms", cycle=cycle, run_id=run_id, manifest=parsed)
    repo.write_publication(
        dataset_id="mrms",
        cycle=cycle,
        run_id=run_id,
        marker=run_publication_marker_dict(
            cycle=cycle,
            dataset_id="mrms",
            run_id=run_id,
            generated_at=valid_at,
            revision=manifest["run"]["revision"],
            manifest_path=repo.paths.relative_key(public_uri),
        ),
    )


def test_publishes_rolling_latest_from_published_timestamp_runs(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    product_config = _product_config()
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611000000",
        valid_at="2026-06-11T00:00:00Z",
        cycle="2026061100",
        run_id="20260611T000000Z-00000000",
    )
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611010000",
        valid_at="2026-06-11T01:00:00Z",
        cycle="2026061101",
        run_id="20260611T010000Z-11111111",
    )
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611023000",
        valid_at="2026-06-11T02:30:00Z",
        cycle="2026061102",
        run_id="20260611T023000Z-22222222",
    )

    result = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T02:35:00Z",
    )

    assert result.ready
    assert result.published
    assert result.frame_count == 2
    latest = repo.read_latest_manifest(dataset_id="mrms")
    assert [frame.id for frame in latest.frames] == ["20260611010000", "20260611023000"]
    assert latest.cycle == "2026061102"
    assert latest.run_id.startswith("20260611T023000Z-")
    assert latest.run.payload_root == "runs/mrms/rolling/payloads"
    assert latest.artifacts["tmp_surface"].frames["20260611010000"].path == (
        "runs/mrms/rolling/payloads/20260611010000/tmp_surface.i16.bin"
    )
    assert repo.store.exists(
        uri=join_uri(
            repo.paths.artifact_root_uri,
            ["runs/mrms/rolling/payloads/20260611010000/tmp_surface.i16.bin"],
        )
    )
    manifest_index = repo.read_manifest_index()
    index_artifact = manifest_index["datasets"]["mrms"]["latest"]["artifacts"]["tmp_surface"]
    assert "frames" not in index_artifact


def test_does_not_move_latest_backward_when_candidate_is_older(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    product_config = _product_config()
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611020000",
        valid_at="2026-06-11T02:00:00Z",
        cycle="2026061102",
        run_id="20260611T020000Z-22222222",
    )
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611030000",
        valid_at="2026-06-11T03:00:00Z",
        cycle="2026061103",
        run_id="20260611T030000Z-33333333",
    )
    published = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 3, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T03:35:00Z",
    )
    assert published.published

    result = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T04:00:00Z",
    )

    assert result.ready
    assert not result.published
    assert result.frame_count == 1
    latest = repo.read_latest_manifest(dataset_id="mrms")
    assert [frame.id for frame in latest.frames] == ["20260611020000", "20260611030000"]


def test_equal_newest_valid_time_can_publish_different_revision(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    product_config = _product_config()
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611020000",
        valid_at="2026-06-11T02:00:00Z",
        cycle="2026061102",
        run_id="20260611T020000Z-11111111",
    )
    first = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T02:35:00Z",
    )
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611020000",
        valid_at="2026-06-11T02:00:00Z",
        cycle="2026061102",
        run_id="20260611T020000Z-22222222",
        revision_suffix="-refresh",
    )

    second = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T02:40:00Z",
    )

    assert first.published
    assert second.published
    assert second.run_id != first.run_id
    latest = repo.read_latest_manifest(dataset_id="mrms")
    assert latest.artifacts["tmp_surface"].frames["20260611020000"].path == (
        "runs/mrms/rolling/payloads/20260611020000/tmp_surface.i16.bin"
    )
    rolling_payload = repo.store.read_bytes(
        uri=join_uri(
            repo.paths.artifact_root_uri,
            ["runs/mrms/rolling/payloads/20260611020000/tmp_surface.i16.bin"],
        )
    )
    assert gzip.decompress(rolling_payload) == _payload_bytes(
        frame_id="20260611020000",
        run_id="20260611T020000Z-22222222",
        revision_suffix="-refresh",
    )


def test_noops_when_no_published_observed_manifests_exist(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    product_config = _product_config()

    result = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T02:35:00Z",
    )

    assert not result.ready
    assert not result.published
    assert not repo.latest_manifest_exists(dataset_id="mrms")


def test_rejects_inconsistent_artifact_metadata(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    product_config = _product_config()
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611010000",
        valid_at="2026-06-11T01:00:00Z",
        cycle="2026061101",
        run_id="20260611T010000Z-11111111",
    )
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611020000",
        valid_at="2026-06-11T02:00:00Z",
        cycle="2026061102",
        run_id="20260611T020000Z-22222222",
        mutation={"units": "bad"},
    )

    with pytest.raises(SystemExit, match="metadata mismatch"):
        publish_rolling_observed_latest(
            product_config=product_config,
            artifact_repo=repo,
            dataset_id="mrms",
            now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
            generated_at="2026-06-11T02:35:00Z",
        )


def test_duplicate_timestamp_runs_produce_one_rolling_frame(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    product_config = _product_config()
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611020000",
        valid_at="2026-06-11T02:00:00Z",
        cycle="2026061102",
        run_id="20260611T020000Z-11111111",
    )
    _write_published_manifest(
        repo,
        product_config,
        frame_id="20260611020000",
        valid_at="2026-06-11T02:00:00Z",
        cycle="2026061102",
        run_id="20260611T020000Z-22222222",
        revision_suffix="-duplicate",
    )

    result = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=repo,
        dataset_id="mrms",
        now=datetime(2026, 6, 11, 2, 35, tzinfo=timezone.utc),
        generated_at="2026-06-11T02:35:00Z",
    )

    assert result.ready
    assert result.frame_count == 1
    latest = repo.read_latest_manifest(dataset_id="mrms")
    assert [frame.id for frame in latest.frames] == ["20260611020000"]
