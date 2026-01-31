"""Subprocess execution helpers.

This module provides a small, testable abstraction around process execution:
- `run_subprocess()` to run a command and capture stdout/stderr
- `RunFn` as an injectable callback type (used by gdal_ops)

The goal is to keep command construction (e.g., GDAL argv building) separate
from the execution mechanism.
"""

from __future__ import annotations

import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence, Union

Arg = Union[str, Path]


@dataclass(frozen=True)
class RunResult:
    argv: tuple[str, ...]
    returncode: int
    stdout: str = ""
    stderr: str = ""


RunFn = Callable[[Sequence[Arg]], RunResult]


def run_subprocess(
    argv: Sequence[Arg],
    *,
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    check: bool = True,
    echo: bool = True,
) -> RunResult:
    """Run a subprocess and return captured outputs.

    When `check=True`, non-zero exit codes raise SystemExit with stdout/stderr.
    """
    cmd = [str(x) for x in argv]
    if echo:
        print("+ " + shlex.join(cmd), flush=True)

    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd is not None else None,
        env={**os.environ, **env} if env is not None else os.environ,
        text=True,
        capture_output=True,
    )

    res = RunResult(
        argv=tuple(cmd),
        returncode=int(proc.returncode),
        stdout=proc.stdout or "",
        stderr=proc.stderr or "",
    )

    if check and res.returncode != 0:
        raise SystemExit(
            "Command failed "
            f"(rc={res.returncode}): {shlex.join(cmd)}\n"
            f"stdout:\n{res.stdout}\n"
            f"stderr:\n{res.stderr}"
        )

    return res


def make_runner(*, cwd: Path | None = None, env: Mapping[str, str] | None = None, echo: bool = True) -> RunFn:
    """Create a `RunFn` bound to a cwd/env configuration."""
    def _run(argv: Sequence[Arg]) -> RunResult:
        return run_subprocess(argv, cwd=cwd, env=env, check=True, echo=echo)

    return _run