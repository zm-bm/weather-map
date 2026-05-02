"""JSON artifact read/write helpers."""

from __future__ import annotations

import json
from typing import Any

from ..stores.base import UriStore


def read_json(*, store: UriStore, uri: str) -> dict[str, Any]:
    data = store.read_bytes(uri=uri)
    return json.loads(data.decode("utf-8"))


def write_json(*, store: UriStore, uri: str, obj: dict[str, Any], indent: int | None = 2) -> None:
    if indent is not None:
        json_text = json.dumps(obj, sort_keys=True, indent=indent)
    else:
        json_text = json.dumps(obj, sort_keys=True)
    data = (json_text + "\n").encode("utf-8")
    store.write_bytes(uri=uri, data=data)
