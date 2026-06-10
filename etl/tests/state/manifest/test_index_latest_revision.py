from __future__ import annotations

from weather_etl.state.manifest.constants import MANIFEST_INDEX_SCHEMA, MANIFEST_INDEX_SCHEMA_VERSION
from weather_etl.state.manifest.index import read_index_latest_revision

from tests.fixtures.artifacts import DEFAULT_RUN_ID, ArtifactFixture


def test_missing_manifest_index_has_no_latest_revision(artifact_fixture: ArtifactFixture) -> None:
    assert read_index_latest_revision(artifact_repo=artifact_fixture.repository, dataset_id="gfs") is None


def test_manifest_index_latest_revision_reads_dataset_latest(artifact_fixture: ArtifactFixture) -> None:
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

    assert read_index_latest_revision(artifact_repo=artifact_fixture.repository, dataset_id="gfs") == "rev-1"
    assert read_index_latest_revision(artifact_repo=artifact_fixture.repository, dataset_id="icon") is None


def test_malformed_manifest_index_has_no_latest_revision(artifact_fixture: ArtifactFixture) -> None:
    artifact_fixture.store.write_bytes(uri=artifact_fixture.paths.manifest_index_uri(), data=b"{not-json")

    assert read_index_latest_revision(artifact_repo=artifact_fixture.repository, dataset_id="gfs") is None
