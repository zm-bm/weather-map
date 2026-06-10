from __future__ import annotations

from typing import Any

import pytest
from weather_etl.state.artifacts.publication_schema import parse_run_publication, run_publication_marker_dict

from tests.fixtures.artifacts import DEFAULT_RUN_ID

PUBLICATION_URI = f"s3://artifacts/runs/icon/2026051106/{DEFAULT_RUN_ID}/publication.json"


def test_run_publication_marker_dict_preserves_wire_shape() -> None:
    marker = run_publication_marker_dict(
        cycle="2026051106",
        dataset_id="icon",
        run_id=DEFAULT_RUN_ID,
        generated_at="2026-05-11T14:05:00+00:00",
        revision="abc123",
        manifest_path=f"manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
    )

    assert marker == {
        "schema": "weather-map.etl-run-publication",
        "schema_version": 1,
        "cycle": "2026051106",
        "dataset_id": "icon",
        "run_id": DEFAULT_RUN_ID,
        "generated_at": "2026-05-11T14:05:00+00:00",
        "manifest_path": f"manifests/icon/cycles/2026051106/runs/{DEFAULT_RUN_ID}.json",
        "revision": "abc123",
    }


def test_parse_run_publication_validates_required_fields() -> None:
    marker = parse_run_publication(_publication_marker(), uri=PUBLICATION_URI)

    assert marker.cycle == "2026051106"
    assert marker.dataset_id == "icon"
    assert marker.revision == "abc123"


def test_parse_run_publication_rejects_missing_revision() -> None:
    marker = _publication_marker()
    marker.pop("revision")

    with pytest.raises(SystemExit):
        parse_run_publication(marker, uri=PUBLICATION_URI)


def test_parse_run_publication_rejects_invalid_cycle() -> None:
    with pytest.raises(SystemExit) as raised:
        parse_run_publication(_publication_marker(cycle="20260511"))

    assert "cycle" in str(raised.value)
    assert "YYYYMMDDHH" in str(raised.value)


def test_parse_run_publication_rejects_unsafe_dataset_id() -> None:
    with pytest.raises(SystemExit) as raised:
        parse_run_publication(_publication_marker(dataset_id="../icon"), uri=PUBLICATION_URI)

    assert "dataset_id" in str(raised.value)
    assert "path separator" in str(raised.value)


def test_parse_run_publication_rejects_invalid_manifest_path() -> None:
    with pytest.raises(SystemExit) as raised:
        parse_run_publication(_publication_marker(manifest_path="/absolute/path.json"), uri=PUBLICATION_URI)

    assert "manifest_path" in str(raised.value)
    assert "relative artifact key" in str(raised.value)


def _publication_marker(
    *,
    cycle: str = "2026051106",
    dataset_id: str = "icon",
    run_id: str = DEFAULT_RUN_ID,
    manifest_path: str | None = None,
) -> dict[str, Any]:
    return {
        "cycle": cycle,
        "dataset_id": dataset_id,
        "run_id": run_id,
        "schema": "weather-map.etl-run-publication",
        "schema_version": 1,
        "generated_at": "2026-05-11T14:05:00+00:00",
        "revision": "abc123",
        "manifest_path": manifest_path or f"manifests/{dataset_id}/cycles/{cycle}/runs/{run_id}.json",
    }
