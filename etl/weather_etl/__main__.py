"""Executable module for `python -m weather_etl`."""

from __future__ import annotations

from .adapters.cli.parser import main

if __name__ == "__main__":
    raise SystemExit(main())
