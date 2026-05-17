"""Forecast catalog loading."""

from __future__ import annotations

import json
from typing import Any

from ..storage.base import UriStore
from ..uris import default_forecast_catalog_uri


def load_forecast_catalog(
    catalog_uri: str | None = None,
    *,
    store: UriStore | None = None,
) -> dict[str, Any]:
    """Load the canonical forecast catalog JSON."""

    from ..storage.routing import make_store

    resolved_store = store if store is not None else make_store()
    uri = catalog_uri or default_forecast_catalog_uri()
    return json.loads(resolved_store.read_bytes(uri=uri).decode("utf-8"))
