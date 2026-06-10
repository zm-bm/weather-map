from __future__ import annotations

from types import SimpleNamespace


class FakePool:
    def __init__(self, *, processes=None) -> None:
        self.processes = processes

    def __enter__(self) -> "FakePool":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def imap_unordered(self, fn, iterable):
        for item in iterable:
            yield fn(item)


def passed_validation():
    return SimpleNamespace(passed=True, errors=())
