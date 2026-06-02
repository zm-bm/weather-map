from __future__ import annotations

from pathlib import Path


def repo_root_from(path: str | Path) -> Path:
    current = Path(path).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists() and (candidate / "etl" / "forecast_etl").exists():
            return candidate
    raise RuntimeError(f"Unable to find repository root from {path!s}")
