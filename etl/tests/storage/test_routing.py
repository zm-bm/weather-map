from __future__ import annotations

from pathlib import Path

from weather_etl.storage.local import LocalFSStore
from weather_etl.storage.routing import RoutingStore


def test_routing_store_normalizes_bare_local_paths(tmp_path: Path) -> None:
    store = RoutingStore(stores={"file": LocalFSStore()})
    path = tmp_path / "runs" / "gfs" / "run.json"

    store.write_bytes(uri=path.as_posix(), data=b"{}")

    assert path.read_bytes() == b"{}"
    assert store.exists(uri=path.as_posix())
