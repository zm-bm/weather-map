"""Refresh the public ETL status document."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..core.timestamps import as_utc
from ..environment import EtlEnvironment
from ..state.inspection.status_document import (
    DEFAULT_STATUS_DATASET_IDS,
    StatusDocumentOptions,
    build_status_document,
    default_status_document_options,
    failed_status_document,
)


@dataclass(frozen=True)
class RefreshStatusResult:
    """Result of writing the public ETL status document."""

    uri: str
    document: dict[str, Any]


def refresh_status(
    *,
    env: EtlEnvironment,
    dataset_ids: tuple[str, ...] | None = None,
    fallback_dataset_ids: tuple[str, ...] = DEFAULT_STATUS_DATASET_IDS,
    options: StatusDocumentOptions | None = None,
    now: datetime | None = None,
) -> RefreshStatusResult:
    """Build and write the public ETL status document."""

    resolved_now = as_utc(now or datetime.now(timezone.utc))
    resolved_options = options or default_status_document_options()

    try:
        product_config = env.load_product_config()
    except (Exception, SystemExit) as exc:
        document = failed_status_document(
            store=env.store,
            artifact_root_uri=env.artifact_root_uri,
            dataset_ids=dataset_ids,
            fallback_dataset_ids=fallback_dataset_ids,
            options=resolved_options,
            now=resolved_now,
            config_error=_error_message(exc),
        )
    else:
        document = build_status_document(
            store=env.store,
            artifact_root_uri=env.artifact_root_uri,
            product_config=product_config,
            dataset_ids=dataset_ids,
            fallback_dataset_ids=fallback_dataset_ids,
            options=resolved_options,
            now=resolved_now,
        )

    return RefreshStatusResult(
        uri=env.artifact_repo.write_status_document(document=document),
        document=document,
    )


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
