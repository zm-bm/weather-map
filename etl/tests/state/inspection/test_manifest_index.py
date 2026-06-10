from __future__ import annotations

from weather_etl.state.inspection.manifest_index import summarize_index
from weather_etl.state.manifest.constants import MANIFEST_INDEX_SCHEMA, MANIFEST_INDEX_SCHEMA_VERSION
from weather_etl.state.manifest.index import build_index

from tests.fixtures.artifacts import DEFAULT_RUN_ID, ArtifactFixture
from tests.fixtures.manifests import cycle_manifest_dict, write_latest_manifest


def test_missing_manifest_index_reports_missing(artifact_fixture: ArtifactFixture) -> None:
    summary = summarize_index(artifact_repo=artifact_fixture.repository)

    assert summary["schema"] == "weather-map.manifest-index-summary"
    assert summary["schema_version"] == 2
    assert summary["status"] == "missing"
    assert summary["path"] == "manifests/index.json"


def test_valid_manifest_index_reports_dataset_and_latest_summary(artifact_fixture: ArtifactFixture) -> None:
    artifact_fixture.repository.write_manifest_index(
        manifest={
            "schema": MANIFEST_INDEX_SCHEMA,
            "schema_version": MANIFEST_INDEX_SCHEMA_VERSION,
            "generated_at": "2026-06-01T12:00:00Z",
            "catalog_version": "test",
            "payload_contract": "weather-map.data-binary/v1",
            "datasets": {
                "gfs": {
                    "label": "GFS",
                    "latest": {
                        "run": {
                            "cycle": "2026060112",
                            "run_id": DEFAULT_RUN_ID,
                            "revision": "rev-1",
                        }
                    },
                },
                "icon": {
                    "label": "ICON",
                    "latest": None,
                },
            },
            "layers": {"tmp_surface": {"datasets": {}}},
        }
    )

    summary = summarize_index(artifact_repo=artifact_fixture.repository)

    assert summary["status"] == "valid"
    assert summary["dataset_count"] == 2
    assert summary["latest_dataset_count"] == 1
    assert summary["layer_count"] == 1
    assert summary["datasets"]["gfs"]["latest_run_id"] == DEFAULT_RUN_ID
    assert not summary["datasets"]["icon"]["latest_present"]


def test_product_aware_manifest_index_reports_current_index_valid(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    _write_latest_manifest(artifact_fixture, product_config=product_config)
    artifact_fixture.repository.write_manifest_index(
        manifest=build_index(
            product_config=product_config,
            artifact_repo=artifact_fixture.repository,
            generated_at="2026-06-01T12:00:00Z",
        )
    )

    summary = summarize_index(
        artifact_repo=artifact_fixture.repository,
        product_config=product_config,
    )

    assert summary["status"] == "valid"
    assert summary["diagnostics"] == []


def test_product_aware_manifest_index_reports_stale_index(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    _write_latest_manifest(artifact_fixture, product_config=product_config)
    manifest_index = build_index(
        product_config=product_config,
        artifact_repo=artifact_fixture.repository,
        generated_at="2026-06-01T12:00:00Z",
    )
    manifest_index["catalog_version"] = "stale"
    artifact_fixture.repository.write_manifest_index(manifest=manifest_index)

    summary = summarize_index(
        artifact_repo=artifact_fixture.repository,
        product_config=product_config,
    )

    assert summary["status"] == "stale"
    assert "manifest index does not match current product config and latest manifests" in summary["diagnostics"]


def test_product_aware_manifest_index_reports_malformed_latest_alias_stale(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    artifact_fixture.store.write_bytes(
        uri=artifact_fixture.paths.latest_manifest_uri(dataset_id="gfs"),
        data=b"{not-json",
    )
    artifact_fixture.repository.write_manifest_index(
        manifest=build_index(
            product_config=product_config,
            artifact_repo=artifact_fixture.repository,
            generated_at="2026-06-01T12:00:00Z",
        )
    )

    summary = summarize_index(
        artifact_repo=artifact_fixture.repository,
        product_config=product_config,
    )

    assert summary["status"] == "stale"
    assert "unable to build expected manifest index: latest manifest for dataset 'gfs' is invalid" in summary["diagnostics"][0]


def test_malformed_manifest_index_reports_diagnostics(artifact_fixture: ArtifactFixture) -> None:
    artifact_fixture.store.write_bytes(uri=artifact_fixture.paths.manifest_index_uri(), data=b"{not-json")

    summary = summarize_index(artifact_repo=artifact_fixture.repository)

    assert summary["status"] == "malformed"
    assert "unable to read JSON" in summary["diagnostics"][0]


def _write_latest_manifest(artifact_fixture: ArtifactFixture, *, product_config) -> None:
    dataset = product_config.dataset("gfs")
    write_latest_manifest(
        artifact_fixture.repository,
        dataset_id="gfs",
        manifest=cycle_manifest_dict(
            dataset,
            cycle="2026060112",
            artifact_ids=("tmp_surface",),
            frames=("000",),
        ),
    )
