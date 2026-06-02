"""Run provenance metadata for worker outputs."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Mapping

if TYPE_CHECKING:
    from .config.resolved import PipelineConfig

UNKNOWN_RUN_METADATA_VALUE = "unknown"


@dataclass(frozen=True)
class RunMetadata:
    """Stable provenance fields written to success markers."""

    code_revision: str
    image_identity: str
    config_digest: str


@dataclass(frozen=True)
class RunSnapshot:
    """Config/catalog evidence captured for one run."""

    metadata: RunMetadata
    pipeline_config: Mapping[str, Any]
    forecast_catalog: Mapping[str, Any]


def pipeline_config_digest(config: PipelineConfig) -> str:
    """Return a deterministic digest for the resolved pipeline config."""

    return json_document_digest(config.model_dump(mode="json"))


def json_document_digest(document: Mapping[str, Any]) -> str:
    """Return a deterministic digest for a JSON-compatible mapping."""

    payload = canonical_json_bytes(document).rstrip(b"\n")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def canonical_json_bytes(document: Mapping[str, Any]) -> bytes:
    """Encode a JSON-compatible mapping with stable formatting."""

    return (json.dumps(dict(document), sort_keys=True, indent=2) + "\n").encode("utf-8")


def run_metadata_from_env(*, config_digest: str) -> RunMetadata:
    """Build marker provenance from worker environment plus config digest."""

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
        config_digest=metadata_value(config_digest),
    )


def metadata_value(value: str | None) -> str:
    """Normalize a non-public marker metadata value."""

    if not isinstance(value, str) or not value.strip():
        return UNKNOWN_RUN_METADATA_VALUE
    return " ".join(value.strip().split())
