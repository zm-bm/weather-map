"""Shared HTTP request policy for upstream source acquisition."""

from __future__ import annotations

import urllib.request

SOURCE_HTTP_TIMEOUT_SECONDS = 60
SOURCE_HTTP_USER_AGENT = "weather-map-etl/1.0"


def source_request(url: str) -> urllib.request.Request:
    """Return a source-acquisition request with the standard ETL user agent."""

    return urllib.request.Request(url, headers={"User-Agent": SOURCE_HTTP_USER_AGENT})
