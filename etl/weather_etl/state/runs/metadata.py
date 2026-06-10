"""Run provenance metadata and persisted run document helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping

from ...core.validation import validate_sha256_digest
from .ids import run_id_created_at, validate_run_id

RUN_METADATA_SCHEMA = "weather-map.etl-run"
RUN_METADATA_SCHEMA_VERSION = 5
UNKNOWN_RUN_METADATA_VALUE = "unknown"


@dataclass(frozen=True)
class RunMetadata:
    """Stable provenance fields written to success markers."""

    code_revision: str
    image_identity: str
    product_config_digest: str

    def __post_init__(self) -> None:
        validate_sha256_digest(self.product_config_digest)


@dataclass(frozen=True)
class RunSnapshot:
    """Config/catalog evidence captured for one run."""

    metadata: RunMetadata
    pipeline: Mapping[str, Any]
    catalog: Mapping[str, Any]


def run_metadata_from_env(*, product_config_digest: str) -> RunMetadata:
    """Build marker provenance from worker environment plus product config digest."""

    return RunMetadata(
        code_revision=metadata_value(
            os.environ.get("ETL_CODE_REVISION")
            or os.environ.get("CODE_REVISION")
            or os.environ.get("GITHUB_SHA")
        ),
        image_identity=metadata_value(
            os.environ.get("ETL_IMAGE_IDENTITY")
            or os.environ.get("IMAGE_IDENTITY")
            or os.environ.get("AWS_BATCH_JOB_DEFINITION")
        ),
        product_config_digest=validate_sha256_digest(product_config_digest),
    )


def run_document_dict(
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
    metadata: RunMetadata,
) -> dict[str, Any]:
    """Build the persisted run metadata document."""

    return {
        **_run_document_identity(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
        "code_revision": metadata.code_revision,
        "image_identity": metadata.image_identity,
        "product_config_digest": metadata.product_config_digest,
    }


def run_metadata_from_document(*, run_doc: Mapping[str, Any]) -> RunMetadata:
    """Parse marker provenance from a persisted run metadata document."""

    return RunMetadata(
        code_revision=metadata_value(_string_or_none(run_doc.get("code_revision"))),
        image_identity=metadata_value(_string_or_none(run_doc.get("image_identity"))),
        product_config_digest=validate_sha256_digest(_string_or_none(run_doc.get("product_config_digest"))),
    )


def validate_run_document_identity(
    *,
    run_doc: Mapping[str, Any],
    dataset_id: str,
    cycle: str,
    run_id: str,
    uri: str,
) -> None:
    """Validate the stable identity fields of a persisted run document."""

    _validate_run_document_fields(
        run_doc=run_doc,
        expected=_run_document_identity(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
        uri=uri,
        title="Run metadata snapshot identity mismatch",
    )


def _validate_run_document_fields(
    *,
    run_doc: Mapping[str, Any],
    expected: Mapping[str, Any],
    uri: str,
    title: str,
) -> None:
    for key, expected_value in expected.items():
        if run_doc.get(key) != expected_value:
            raise SystemExit(
                f"{title}:\n"
                f"  run={uri}\n"
                f"  field={key}\n"
                f"  expected={expected_value!r}\n"
                f"  found={run_doc.get(key)!r}"
            )


def _run_document_identity(*, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    return {
        "schema": RUN_METADATA_SCHEMA,
        "schema_version": RUN_METADATA_SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": validate_run_id(run_id),
        "created_at": run_id_created_at(run_id),
    }


def metadata_value(value: str | None) -> str:
    """Normalize a non-public marker metadata value."""

    if not isinstance(value, str) or not value.strip():
        return UNKNOWN_RUN_METADATA_VALUE
    return " ".join(value.strip().split())


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None
