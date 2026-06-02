"""Output formatting helpers for forecast-etl CLI commands."""

from __future__ import annotations

import json


def print_not_ready(*, label: str, dataset_id: str, cycle: str, result: object) -> None:
    message = getattr(result, "message", None)
    errors = tuple(getattr(result, "errors", ()) or ())
    if message and not message.startswith("run selection failed"):
        print(f"{label} not ready: {message}")
        return
    print(f"{label} not ready: run selection failed for dataset_id={dataset_id} cycle={cycle}")
    if message and not errors:
        print(f"run error: {message}")
    for error in errors:
        print(f"run error: {error}")


def print_operator_report(report: dict, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(report, sort_keys=True, indent=2))
        return
    print_key_values(report)


def print_key_values(value: object, *, prefix: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_prefix = f"{prefix}.{key}" if prefix else str(key)
            print_key_values(nested, prefix=nested_prefix)
        return
    if isinstance(value, list):
        if all(not isinstance(item, (dict, list)) for item in value):
            print(f"{prefix}={','.join(operator_value(item) for item in value)}")
            return
        for index, item in enumerate(value):
            print_key_values(item, prefix=f"{prefix}.{index}")
        return
    print(f"{prefix}={operator_value(value)}")


def operator_value(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)

