from __future__ import annotations

import hashlib
import json
from typing import Any

import pytest
from weather_etl.state.manifest.build import build_cycle_manifest
from weather_etl.state.manifest.constants import (
    DATA_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from weather_etl.state.manifest.revision import compute_manifest_revision

from tests.fixtures.artifact_configs import (
    cloud_layers_config,
    minimal_artifact_config,
    precip_rate_config,
    wind_artifact_config,
)
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.manifests import manifest_artifact_entry
from tests.fixtures.markers import write_json
from tests.fixtures.pipeline import loaded_product_config
from tests.fixtures.publish import PublishFixture, publish_fixture


def _assert_manifest_identity(manifest: dict[str, Any], *, fx: PublishFixture, artifact_ids: tuple[str, ...]) -> None:
    assert manifest["schema"] == MANIFEST_SCHEMA
    assert manifest["schema_version"] == MANIFEST_SCHEMA_VERSION
    assert manifest["payload_contract"] == DATA_BINARY_CONTRACT
    assert manifest["dataset"] == {"id": fx.dataset_id, "label": fx.dataset_label}
    assert manifest["run"]["cycle"] == fx.cycle
    assert manifest["run"]["run_id"] == fx.run_id
    assert manifest["run"]["payload_root"] == f"runs/{fx.dataset_id}/{fx.cycle}/{fx.run_id}/payloads"
    assert "generated_at" in manifest["run"]
    assert "revision" in manifest["run"]
    assert "groups" not in manifest
    assert set(manifest["artifacts"]) == set(artifact_ids)


def _assert_payload_hashes_match_storage(
    *,
    fx: PublishFixture,
    manifest: dict[str, Any],
    artifact_ids: tuple[str, ...],
    dtype: str = "int16",
) -> None:
    for frame_id in fx.frames:
        for artifact_id in artifact_ids:
            frame = manifest["artifacts"][artifact_id]["frames"][frame_id]
            assert frame["byte_length"] == fx.cell_count * 2
            payload_bytes = fx.payload_bytes(artifact_id=artifact_id, frame_id=frame_id, dtype=dtype)
            assert len(payload_bytes) == frame["byte_length"]
            assert hashlib.sha256(payload_bytes).hexdigest() == frame["sha256"]


def test_manifest_revision_is_computed_from_manifest_object() -> None:
    manifest = build_cycle_manifest(
        dataset_id="gfs",
        dataset_label="GFS",
        cycle="2026041100",
        run_id=DEFAULT_RUN_ID,
        payload_root=f"runs/gfs/2026041100/{DEFAULT_RUN_ID}/payloads",
        generated_at="2026-04-11T01:00:00+00:00",
        frames=("000",),
        artifacts={
            "tmp_surface": manifest_artifact_entry(
                "tmp_surface",
                cycle="2026041100",
                run_id=DEFAULT_RUN_ID,
                byte_length=2,
            ),
        },
    )

    manifest_obj = manifest.to_stored_dict()
    revision = manifest.revision
    assert compute_manifest_revision(manifest_obj) == revision

    generated_changed = json.loads(json.dumps(manifest_obj))
    generated_changed["run"]["generated_at"] = "2026-04-11T02:00:00+00:00"
    generated_changed["run"]["revision"] = "ignored"
    assert compute_manifest_revision(generated_changed) == revision

    artifact_changed = json.loads(json.dumps(manifest_obj))
    artifact_changed["artifacts"]["tmp_surface"]["parameter"] = "tmp_v2"
    assert compute_manifest_revision(artifact_changed) != revision


def test_manifest_uses_observed_frame_valid_times_when_provided() -> None:
    manifest = build_cycle_manifest(
        dataset_id="mrms",
        dataset_label="MRMS",
        cycle="2026061100",
        run_id=DEFAULT_RUN_ID,
        payload_root=f"runs/mrms/2026061100/{DEFAULT_RUN_ID}/payloads",
        generated_at="2026-06-11T01:00:00Z",
        frames=("20260611000000", "20260611000200"),
        frame_valid_times={
            "20260611000000": "2026-06-11T00:00:00Z",
            "20260611000200": "2026-06-11T00:02:00Z",
        },
        artifacts={
            "observed_radar_composite_reflectivity": manifest_artifact_entry(
                "observed_radar_composite_reflectivity",
                cycle="2026061100",
                run_id=DEFAULT_RUN_ID,
                frame_ids=("20260611000000", "20260611000200"),
                byte_length=2,
            ),
        },
    )

    assert [frame.model_dump() for frame in manifest.frames] == [
        {"id": "20260611000000", "lead_hours": 0, "valid_at": "2026-06-11T00:00:00Z"},
        {"id": "20260611000200", "lead_hours": 0, "valid_at": "2026-06-11T00:02:00Z"},
    ]


def test_publish_writes_scalar_manifest_and_is_idempotent() -> None:
    with publish_fixture(prefix="weather-map-publish-scalar-", frames=("000", "003")) as fx:
        artifact_ids = ("tmp_surface", "rh_surface")
        artifacts_cfg = {
            "tmp_surface": minimal_artifact_config(),
            "rh_surface": {
                **minimal_artifact_config(),
                "level": "surface",
                "parameter": "rh",
                "units": "%",
                "encoding": {
                    "id": "rh_surface_i16_v1",
                    "format": "linear-i16-v1",
                    "dtype": "int16",
                    "byte_order": "little",
                    "scale": 0.01,
                    "offset": 0.0,
                    "nodata": -32768,
                    "finite_value_range": {"min": 0, "max": 100},
                },
            },
        }

        fx.write_scalar_markers(artifact_id="tmp_surface", base=-10.0, artifact_config=artifacts_cfg["tmp_surface"])
        fx.write_scalar_markers(artifact_id="rh_surface", base=20.0, artifact_config=artifacts_cfg["rh_surface"])

        result_first = fx.publish(
            artifact_ids=artifact_ids,
            artifacts_cfg=artifacts_cfg,
        )
        assert result_first.ready
        assert not result_first.already_published

        cycle_manifest = fx.cycle_manifest()
        latest_manifest = fx.latest_manifest()
        current_manifest = fx.current_manifest()

        _assert_manifest_identity(cycle_manifest, fx=fx, artifact_ids=artifact_ids)
        assert cycle_manifest["frames"] == [
            {"id": "000", "lead_hours": 0, "valid_at": "2026-04-11T00:00:00Z"},
            {"id": "003", "lead_hours": 3, "valid_at": "2026-04-11T03:00:00Z"},
        ]
        assert cycle_manifest["artifacts"]["tmp_surface"]["kind"] == "scalar"
        assert cycle_manifest["artifacts"]["tmp_surface"]["components"] == ["value"]
        assert cycle_manifest["artifacts"]["tmp_surface"]["payload_file"] == "tmp_surface.i16.bin"
        assert "label" not in cycle_manifest["artifacts"]["tmp_surface"]
        assert "valueRange" not in cycle_manifest["artifacts"]["tmp_surface"]
        assert "temporal_kind" not in cycle_manifest["artifacts"]["tmp_surface"]
        assert "source_interval_hours" not in cycle_manifest["artifacts"]["tmp_surface"]
        assert cycle_manifest["artifacts"]["tmp_surface"]["grid"]["id"] == "gfs_0p25_global"
        assert cycle_manifest["artifacts"]["tmp_surface"]["grid"]["x_wrap"] == "repeat"
        assert cycle_manifest["artifacts"]["tmp_surface"]["grid"]["y_mode"] == "clamp"
        assert cycle_manifest["artifacts"]["tmp_surface"]["encoding"]["byte_order"] == "little"
        assert cycle_manifest["artifacts"]["rh_surface"]["encoding"]["finite_value_range"] == {"min": 0.0, "max": 100.0}
        assert (
            cycle_manifest["artifacts"]["tmp_surface"]["frames"]["000"]["path"]
            == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads/000/tmp_surface.i16.bin"
        )
        assert (
            cycle_manifest["artifacts"]["rh_surface"]["frames"]["003"]["path"]
            == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads/003/rh_surface.i16.bin"
        )
        assert latest_manifest == cycle_manifest
        assert current_manifest == cycle_manifest
        assert not fx.store.exists(uri=f"{fx.artifact_root_uri.rstrip('/')}/manifests/{fx.dataset_id}/{fx.cycle}.json")
        assert (
            fx.artifacts.read_run_manifest(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id).to_stored_dict()
            == cycle_manifest
        )
        assert fx.artifacts.publication_exists(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id)
        assert fx.artifacts.read_publication(
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        ).manifest_path == fx.ap.public_run_manifest_key(
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        )
        _assert_payload_hashes_match_storage(fx=fx, manifest=cycle_manifest, artifact_ids=artifact_ids)

        result_second = fx.publish(
            artifact_ids=artifact_ids,
            artifacts_cfg=artifacts_cfg,
        )
        assert result_second.ready
        assert result_second.already_published


def test_publish_rejects_marker_payload_uri_mismatch() -> None:
    with publish_fixture(prefix="weather-map-publish-payload-uri-mismatch-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)
        marker_uri = fx.marker_uri(artifact_id)
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker["artifact"]["payload_uri"] = "file:///wrong/path.bin"
        write_json(marker_uri, marker)

        with pytest.raises(SystemExit, match="Artifact payload_uri mismatch"):
            fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
            )


def test_publish_writes_manifest_index_from_product_config() -> None:
    catalog = {
        "catalogVersion": "test-forecast-catalog",
        "rasterLayers": [
            {"id": "published_artifact", "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]}},
        ],
    }

    with publish_fixture(prefix="weather-map-publish-manifest-index-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        product_config = loaded_product_config(catalog=catalog)
        fx.write_scalar_marker(
            artifact_id=artifact_id,
            artifact_config=artifact_cfg,
        )

        result = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            product_config=product_config,
        )

        assert result.ready
        assert fx.artifacts.manifest_index_exists()
        manifest_index = fx.artifacts.read_manifest_index()
        assert manifest_index["schema"] == "weather-map.manifest-index"
        assert manifest_index["schema_version"] == 3
        assert manifest_index["payload_contract"] == "field-binary-v2"
        assert manifest_index["catalog_version"] == "test-forecast-catalog"
        assert "latest_cycle" not in manifest_index["datasets"]["gfs"]
        assert "latest_manifest_path" not in manifest_index["datasets"]["gfs"]
        latest = manifest_index["datasets"]["gfs"]["latest"]
        assert latest["run"]["cycle"] == fx.cycle
        assert latest["run"]["run_id"] == fx.run_id
        assert latest["run"]["payload_root"] == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads"
        assert latest["frames"][0]["id"] == "000"
        assert "schema" not in latest
        assert "schema_version" not in latest
        assert "payload_contract" not in latest
        latest_artifact = latest["artifacts"]["tmp_surface"]
        assert latest_artifact["byte_length"] == fx.cell_count * 2
        assert latest_artifact["payload_file"] == "tmp_surface.i16.bin"
        assert "frames" not in latest_artifact
        assert "path" not in latest_artifact
        assert "sha256" not in latest_artifact
        assert manifest_index["layers"]["published_artifact"]["datasets"]["gfs"]["state"] == "available"
        assert "groups" not in fx.cycle_manifest()


def test_publish_includes_artifact_temporal_metadata() -> None:
    with publish_fixture(
        prefix="weather-map-publish-temporal-",
        dataset_id="icon",
        dataset_label="ICON",
    ) as fx:
        artifacts_cfg = {
            "prate_surface": precip_rate_config(),
        }
        fx.write_scalar_marker(
            artifact_id="prate_surface",
            values=[0.0 for _ in range(fx.cell_count)],
            artifact_config=artifacts_cfg["prate_surface"],
        )

        result = fx.publish(
            artifact_ids=("prate_surface",),
            artifacts_cfg=artifacts_cfg,
        )

        assert result.ready
        artifact = fx.cycle_manifest()["artifacts"]["prate_surface"]
        assert artifact["temporal_kind"] == "average_rate"
        assert artifact["source_interval_hours"] == 1.0


def test_publish_writes_temperature_piecewise_encoding_manifest() -> None:
    with publish_fixture(prefix="weather-map-publish-temp-piecewise-") as fx:
        artifact_ids = ("tmp_surface",)
        artifacts_cfg = {
            "tmp_surface": {
                **minimal_artifact_config(),
                "parameter": "tmp",
                "level": "surface",
                "units": "C",
                "source_transform": "identity",
                "encoding": {
                    "id": "tmp_surface_i8_temp_c_piecewise_v1",
                    "format": "temp-c-piecewise-i8-v1",
                    "dtype": "int8",
                    "byte_order": "none",
                    "nodata": -128,
                },
            },
        }

        fx.write_scalar_marker(
            artifact_id="tmp_surface",
            values=fx.values(-35.0),
            artifact_config=artifacts_cfg["tmp_surface"],
        )

        result = fx.publish(
            artifact_ids=artifact_ids,
            artifacts_cfg=artifacts_cfg,
        )

        assert result.ready
        cycle_manifest = fx.cycle_manifest()
        artifact = cycle_manifest["artifacts"]["tmp_surface"]
        encoding = artifact["encoding"]
        assert encoding == {
            "id": "tmp_surface_i8_temp_c_piecewise_v1",
            "format": "temp-c-piecewise-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
        }
        assert artifact["frames"]["000"]["path"] == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads/000/tmp_surface.i8.bin"
        assert artifact["frames"]["000"]["byte_length"] == fx.cell_count


def test_publish_writes_cloud_layers_vector_manifest() -> None:
    with publish_fixture(prefix="weather-map-publish-cloud-layers-") as fx:
        artifact_ids = ("cloud_layers",)
        artifacts_cfg = {
            "cloud_layers": cloud_layers_config(),
        }

        fx.write_vector_marker(
            artifact_id="cloud_layers",
            artifact_config=artifacts_cfg["cloud_layers"],
        )

        result = fx.publish(
            artifact_ids=artifact_ids,
            artifacts_cfg=artifacts_cfg,
        )

        assert result.ready
        cycle_manifest = fx.cycle_manifest()
        artifact = cycle_manifest["artifacts"]["cloud_layers"]
        encoding = artifact["encoding"]
        assert encoding == {
            "id": "cloud_layers_vector_i8_4pct_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
            "scale": 4.0,
            "offset": 0.0,
            "decode_formula": "value = stored * scale + offset",
            "finite_value_range": {"min": 0.0, "max": 100.0},
        }
        assert artifact["components"] == ["low", "middle", "high"]
        assert artifact["kind"] == "vector"
        assert artifact["units"] == "%"
        assert artifact["parameter"] == "cloud_layers"
        assert "valueRange" not in artifact
        assert artifact["frames"]["000"]["path"] == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads/000/cloud_layers.i8.bin"
        assert artifact["frames"]["000"]["byte_length"] == fx.cell_count * 3


def test_publish_writes_vector_only_manifest() -> None:
    with publish_fixture(prefix="weather-map-publish-vector-only-", cycle="2026041200", frames=("000", "003")) as fx:
        vector_artifacts = ("wind10m_uv",)

        fx.write_vector_markers()

        result = fx.publish(
            artifact_ids=vector_artifacts,
            artifacts_cfg={"wind10m_uv": wind_artifact_config()},
        )
        assert result.ready
        assert not result.already_published

        cycle_manifest = fx.cycle_manifest()
        latest_manifest = fx.latest_manifest()
        assert "groups" not in cycle_manifest
        assert list(cycle_manifest["artifacts"].keys()) == ["wind10m_uv"]
        assert cycle_manifest["artifacts"]["wind10m_uv"]["kind"] == "vector"
        assert cycle_manifest["artifacts"]["wind10m_uv"]["components"] == ["u", "v"]
        assert latest_manifest == cycle_manifest
        assert (
            cycle_manifest["artifacts"]["wind10m_uv"]["frames"]["000"]["path"]
            == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads/000/wind10m_uv.i8.bin"
        )


def test_publish_includes_wind_frames_and_metadata_without_sidecars() -> None:
    with publish_fixture(prefix="weather-map-publish-wind-", cycle="2026041200", frames=("000", "003")) as fx:
        scalar_artifacts = ("tmp_surface",)
        vector_artifacts = ("wind10m_uv",)
        artifacts_cfg = {
            "tmp_surface": minimal_artifact_config(),
        }

        fx.write_scalar_markers(artifact_id="tmp_surface", base=-10.0, artifact_config=artifacts_cfg["tmp_surface"])
        fx.write_vector_markers()

        result = fx.publish(
            artifact_ids=scalar_artifacts + vector_artifacts,
            artifacts_cfg={**artifacts_cfg, "wind10m_uv": wind_artifact_config()},
        )
        assert result.ready
        assert not result.already_published

        cycle_manifest = fx.cycle_manifest()
        latest_manifest = fx.latest_manifest()
        assert cycle_manifest["schema"] == MANIFEST_SCHEMA
        assert cycle_manifest["schema_version"] == MANIFEST_SCHEMA_VERSION
        assert cycle_manifest["payload_contract"] == DATA_BINARY_CONTRACT
        assert "groups" not in cycle_manifest
        assert list(cycle_manifest["artifacts"].keys()) == ["tmp_surface", "wind10m_uv"]
        assert (
            cycle_manifest["artifacts"]["wind10m_uv"]["frames"]["000"]["path"]
            == f"runs/gfs/{fx.cycle}/{fx.run_id}/payloads/000/wind10m_uv.i8.bin"
        )
        assert cycle_manifest["artifacts"]["wind10m_uv"]["components"] == ["u", "v"]
        assert latest_manifest == cycle_manifest
