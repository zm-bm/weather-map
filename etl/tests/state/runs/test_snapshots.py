from __future__ import annotations

import json
from typing import Any

import pytest
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.config.product import product_config_document_digest
from weather_etl.state.runs.metadata import RunMetadata, RunSnapshot
from weather_etl.state.runs.snapshots import ensure_run_snapshot, load_run_snapshot

from tests.fixtures.artifacts import DEFAULT_IMAGE_IDENTITY, DEFAULT_RUN_ID, ArtifactFixture
from tests.fixtures.catalog import catalog_for_dataset

CYCLE = "2026041100"


def test_load_run_snapshot_reads_valid_snapshot(artifact_fixture: ArtifactFixture, raw_pipeline_config_factory) -> None:
    raw_config = raw_pipeline_config_factory()
    catalog = _catalog_for_raw_config(raw_config)
    _write_snapshot(artifact_fixture, raw_config=raw_config, catalog=catalog)
    digest = _product_config_digest(raw_config=raw_config, catalog=catalog)

    snapshot = _load_snapshot(artifact_fixture)

    assert snapshot.run_id == DEFAULT_RUN_ID
    assert snapshot.product_config_digest == digest
    assert snapshot.pipeline_uri == artifact_fixture.paths.run_pipeline_uri(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=DEFAULT_RUN_ID,
    )
    assert snapshot.catalog_uri == artifact_fixture.paths.run_catalog_uri(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=DEFAULT_RUN_ID,
    )
    assert snapshot.raw_pipeline_config == raw_config
    assert snapshot.catalog == catalog
    assert snapshot.metadata == RunMetadata(
        code_revision="test-revision",
        image_identity=DEFAULT_IMAGE_IDENTITY,
        product_config_digest=digest,
    )
    assert snapshot.run_snapshot.metadata == snapshot.metadata
    assert snapshot.run_snapshot.pipeline == raw_config
    assert snapshot.run_snapshot.catalog == catalog


def test_load_run_snapshot_reports_missing_run_metadata(artifact_fixture: ArtifactFixture) -> None:
    with pytest.raises(FileNotFoundError, match="Missing run metadata snapshot"):
        _load_snapshot(artifact_fixture)


def test_load_run_snapshot_rejects_product_config_digest_mismatch(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
) -> None:
    _write_snapshot(artifact_fixture, raw_config=raw_pipeline_config_factory())
    _update_run_doc(artifact_fixture, product_config_digest="sha256:" + "1" * 64)

    with pytest.raises(SystemExit) as exc:
        _load_snapshot(artifact_fixture)

    assert "Run snapshot product config digest mismatch" in str(exc.value)


@pytest.mark.parametrize(
    ("payload", "message"),
    (
        (b"{", "Failed to parse JSON document"),
        (b'["not", "object"]', "must be an object"),
    ),
)
def test_load_run_snapshot_rejects_invalid_catalog_json(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
    payload: bytes,
    message: str,
) -> None:
    _write_snapshot(artifact_fixture, raw_config=raw_pipeline_config_factory())
    artifact_fixture.store.write_bytes(
        uri=artifact_fixture.paths.run_catalog_uri(dataset_id="gfs", cycle=CYCLE, run_id=DEFAULT_RUN_ID),
        data=payload,
    )

    with pytest.raises(SystemExit, match=message):
        _load_snapshot(artifact_fixture)


def test_ensure_run_snapshot_rejects_invalid_source_catalog_json(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
) -> None:
    source_pipeline_uri = (artifact_fixture.root_dir / "source" / "pipeline.json").as_uri()
    source_catalog_uri = (artifact_fixture.root_dir / "source" / "catalog.json").as_uri()
    artifact_fixture.store.write_bytes(
        uri=source_pipeline_uri,
        data=(json.dumps(raw_pipeline_config_factory(), sort_keys=True, indent=2) + "\n").encode("utf-8"),
    )
    artifact_fixture.store.write_bytes(uri=source_catalog_uri, data=b"{")

    with pytest.raises(SystemExit, match="Failed to parse JSON document"):
        ensure_run_snapshot(
            artifact_repo=artifact_fixture.repository,
            store=artifact_fixture.store,
            dataset_id="gfs",
            cycle=CYCLE,
            run_id=DEFAULT_RUN_ID,
            pipeline_uri=source_pipeline_uri,
            catalog_uri=source_catalog_uri,
        )


def test_ensure_run_snapshot_rejects_source_catalog_pipeline_drift(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
) -> None:
    source_pipeline_uri = (artifact_fixture.root_dir / "source" / "pipeline.json").as_uri()
    source_catalog_uri = (artifact_fixture.root_dir / "source" / "catalog.json").as_uri()
    artifact_fixture.store.write_bytes(
        uri=source_pipeline_uri,
        data=(json.dumps(raw_pipeline_config_factory(), sort_keys=True, indent=2) + "\n").encode("utf-8"),
    )
    artifact_fixture.store.write_bytes(
        uri=source_catalog_uri,
        data=(json.dumps(_drifted_catalog(), sort_keys=True, indent=2) + "\n").encode("utf-8"),
    )

    with pytest.raises(SystemExit, match="unknown artifact"):
        ensure_run_snapshot(
            artifact_repo=artifact_fixture.repository,
            store=artifact_fixture.store,
            dataset_id="gfs",
            cycle=CYCLE,
            run_id=DEFAULT_RUN_ID,
            pipeline_uri=source_pipeline_uri,
            catalog_uri=source_catalog_uri,
        )


def test_ensure_run_snapshot_rejects_static_invalid_pipeline_config(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
) -> None:
    raw_config = raw_pipeline_config_factory(dataset_ids=("icon",))
    catalog = _catalog_for_raw_config(raw_config, dataset_id="icon")
    raw_config["datasets"]["icon"]["source"] = {
        "type": "future_radar",
        "grid_id": "radar_grid",
    }
    source_pipeline_uri = (artifact_fixture.root_dir / "source" / "pipeline.json").as_uri()
    source_catalog_uri = (artifact_fixture.root_dir / "source" / "catalog.json").as_uri()
    artifact_fixture.store.write_bytes(
        uri=source_pipeline_uri,
        data=(json.dumps(raw_config, sort_keys=True, indent=2) + "\n").encode("utf-8"),
    )
    artifact_fixture.store.write_bytes(
        uri=source_catalog_uri,
        data=(
            json.dumps(
                catalog,
                sort_keys=True,
                indent=2,
            )
            + "\n"
        ).encode("utf-8"),
    )

    with pytest.raises(SystemExit, match="Unsupported dataset source type"):
        ensure_run_snapshot(
            artifact_repo=artifact_fixture.repository,
            store=artifact_fixture.store,
            dataset_id="icon",
            cycle=CYCLE,
            run_id=DEFAULT_RUN_ID,
            pipeline_uri=source_pipeline_uri,
            catalog_uri=source_catalog_uri,
        )


def test_load_run_snapshot_rejects_catalog_pipeline_drift(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
) -> None:
    _write_snapshot(
        artifact_fixture,
        raw_config=raw_pipeline_config_factory(),
        catalog=_drifted_catalog(),
    )

    with pytest.raises(SystemExit, match="unknown artifact"):
        _load_snapshot(artifact_fixture)


def test_load_run_snapshot_rejects_static_invalid_pipeline_config(
    artifact_fixture: ArtifactFixture,
    raw_pipeline_config_factory,
) -> None:
    raw_config = raw_pipeline_config_factory(dataset_ids=("icon",))
    catalog = _catalog_for_raw_config(raw_config, dataset_id="icon")
    raw_config["datasets"]["icon"]["source"] = {
        "type": "future_radar",
        "grid_id": "radar_grid",
    }
    _write_snapshot(
        artifact_fixture,
        dataset_id="icon",
        raw_config=raw_config,
        catalog=catalog,
    )

    with pytest.raises(SystemExit, match="Unsupported dataset source type"):
        _load_snapshot(artifact_fixture, dataset_id="icon")


def _load_snapshot(artifact_fixture: ArtifactFixture, *, dataset_id: str = "gfs"):
    return load_run_snapshot(
        artifact_repo=artifact_fixture.repository,
        store=artifact_fixture.store,
        dataset_id=dataset_id,
        cycle=CYCLE,
        run_id=DEFAULT_RUN_ID,
    )


def _write_snapshot(
    artifact_fixture: ArtifactFixture,
    *,
    dataset_id: str = "gfs",
    raw_config: dict[str, Any],
    catalog: dict[str, Any] | None = None,
) -> str:
    resolved_catalog = catalog or _catalog_for_raw_config(raw_config)
    snapshot = RunSnapshot(
        metadata=RunMetadata(
            code_revision="test-revision",
            image_identity=DEFAULT_IMAGE_IDENTITY,
            product_config_digest=_product_config_digest(raw_config=raw_config, catalog=resolved_catalog),
        ),
        pipeline=raw_config,
        catalog=resolved_catalog,
    )
    return artifact_fixture.repository.ensure_run_snapshot(
        dataset_id=dataset_id,
        cycle=CYCLE,
        run_id=DEFAULT_RUN_ID,
        snapshot=snapshot,
    )


def _update_run_doc(artifact_fixture: ArtifactFixture, **updates: str) -> None:
    run_uri = artifact_fixture.paths.run_metadata_uri(dataset_id="gfs", cycle=CYCLE, run_id=DEFAULT_RUN_ID)
    run_doc = artifact_fixture.repository.read_json_uri(run_uri)
    artifact_fixture.store.write_bytes(
        uri=run_uri,
        data=(json.dumps({**run_doc, **updates}, sort_keys=True, indent=2) + "\n").encode("utf-8"),
    )


def _drifted_catalog() -> dict[str, Any]:
    return {
        "catalogVersion": "test",
        "rasterLayers": [
            {
                "id": "missing_layer",
                "source": {"artifactId": "missing_surface", "bands": [{"id": "value"}]},
            }
        ],
    }


def _catalog_for_raw_config(raw_config: dict[str, Any], *, dataset_id: str = "gfs") -> dict[str, Any]:
    return catalog_for_dataset(parse_pipeline_config(raw_config).dataset(dataset_id))


def _product_config_digest(*, raw_config: dict[str, Any], catalog: dict[str, Any]) -> str:
    return product_config_document_digest(pipeline=raw_config, catalog=catalog)
