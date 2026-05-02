"""GDAL command helpers.

This module builds argv for GDAL utilities and parses a small amount of GDAL
output (e.g. `gdalinfo -json`).

It intentionally contains no direct subprocess calls: callers provide a
`run(argv) -> RunResult` callback so execution can be local, containerized, etc.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..proc import RunFn, RunResult


@dataclass(frozen=True)
class TranslateOpts:
    """Options for `gdal_translate`."""

    band: Optional[int] = None
    output_type: Optional[str] = None
    output_format: Optional[str] = None
    creation_options: tuple[str, ...] = ()


def gdal_translate(src: Path, dst: Path, *, opts: TranslateOpts, run: RunFn) -> RunResult:
    """Run `gdal_translate` with the provided options."""
    argv: list[str] = ["gdal_translate"]
    if opts.band is not None:
        argv += ["-b", str(int(opts.band))]
    if opts.output_type is not None:
        argv += ["-ot", opts.output_type]
    if opts.output_format is not None:
        argv += ["-of", opts.output_format]
    for co in opts.creation_options:
        argv += ["-co", co]
    argv += [str(src), str(dst)]
    return run(argv)


def gdalinfo_json(path: Path, *, run: RunFn) -> dict:
    """Return parsed JSON from `gdalinfo -json` for the given dataset."""
    res = run(["gdalinfo", "-json", str(path)])
    try:
        return json.loads(res.stdout)
    except Exception as e:
        raise RuntimeError(
            f"Failed to parse gdalinfo JSON for {path}: {e}\n"
            f"stdout:\n{res.stdout}\n"
            f"stderr:\n{res.stderr}"
        ) from e
