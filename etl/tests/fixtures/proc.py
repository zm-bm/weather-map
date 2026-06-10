from __future__ import annotations

from weather_etl.processing.proc import RunResult


def noop_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)
