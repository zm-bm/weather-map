from __future__ import annotations

from unittest.mock import patch

import pytest
from weather_etl.state.runs.metadata import (
    RUN_METADATA_SCHEMA,
    RUN_METADATA_SCHEMA_VERSION,
    RunMetadata,
    metadata_value,
    run_document_dict,
    run_metadata_from_env,
    validate_run_document_identity,
)

from tests.fixtures.artifacts import DEFAULT_RUN_ID


def test_run_metadata_from_env_uses_worker_provenance() -> None:
    with patch.dict(
        "os.environ",
        {
            "ETL_CODE_REVISION": "abc123",
            "ETL_IMAGE_IDENTITY": "weather-etl-worker:abc123",
        },
        clear=True,
    ):
        metadata = run_metadata_from_env(product_config_digest="sha256:" + "1" * 64)

    assert metadata.code_revision == "abc123"
    assert metadata.image_identity == "weather-etl-worker:abc123"
    assert metadata.product_config_digest == "sha256:" + "1" * 64


def test_metadata_value_falls_back_to_unknown() -> None:
    assert metadata_value(" \n ") == "unknown"


@pytest.mark.parametrize("value", [None, "", "unknown", "digest", "sha256:" + "z" * 64])
def test_run_metadata_rejects_invalid_product_config_digest(value: object) -> None:
    with pytest.raises(ValueError):
        RunMetadata(
            code_revision="abc123",
            image_identity="image",
            product_config_digest=value,  # type: ignore[arg-type]
        )


def test_run_document_dict_preserves_persisted_contract_shape() -> None:
    document = run_document_dict(
        dataset_id="gfs",
        cycle="2026041100",
        run_id=DEFAULT_RUN_ID,
        metadata=RunMetadata(
            code_revision="abc123",
            image_identity="weather-etl-worker:abc123",
            product_config_digest="sha256:" + "1" * 64,
        ),
    )

    assert document == {
        "schema": RUN_METADATA_SCHEMA,
        "schema_version": RUN_METADATA_SCHEMA_VERSION,
        "dataset_id": "gfs",
        "cycle": "2026041100",
        "run_id": DEFAULT_RUN_ID,
        "created_at": "2026-04-11T00:00:00Z",
        "code_revision": "abc123",
        "image_identity": "weather-etl-worker:abc123",
        "product_config_digest": "sha256:" + "1" * 64,
    }


def test_validate_run_document_identity_reports_mismatch() -> None:
    document = run_document_dict(
        dataset_id="gfs",
        cycle="2026041100",
        run_id=DEFAULT_RUN_ID,
        metadata=RunMetadata(code_revision="abc123", image_identity="image", product_config_digest="sha256:" + "1" * 64),
    )

    with pytest.raises(SystemExit, match="field=cycle"):
        validate_run_document_identity(
            run_doc={**document, "cycle": "2026041106"},
            dataset_id="gfs",
            cycle="2026041100",
            run_id=DEFAULT_RUN_ID,
            uri="file:///artifacts/runs/gfs/2026041100/run.json",
        )
