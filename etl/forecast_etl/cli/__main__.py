"""Executable module for `python -m forecast_etl.cli`."""

from __future__ import annotations

from .parser import main

if __name__ == "__main__":
    raise SystemExit(main())
