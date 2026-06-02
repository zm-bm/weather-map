"""Small CloudWatch metric helpers for AWS Lambda adapters."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

DEFAULT_METRIC_NAMESPACE = "WeatherMap/ETL"
MAX_PUT_METRIC_DATA_ITEMS = 20


def cloudwatch_client() -> Any:
    """Return a CloudWatch client, importing boto3 lazily."""

    import boto3

    return boto3.client("cloudwatch")


def metric_datum(
    *,
    name: str,
    value: float | int,
    dimensions: Mapping[str, str] | None = None,
    unit: str = "Count",
) -> dict[str, Any]:
    """Build one CloudWatch metric datum."""

    datum: dict[str, Any] = {
        "MetricName": name,
        "Value": float(value),
        "Unit": unit,
    }
    if dimensions:
        datum["Dimensions"] = [{"Name": key, "Value": value} for key, value in sorted(dimensions.items())]
    return datum


def emit_metrics(*, cloudwatch: Any, namespace: str, metrics: Iterable[Mapping[str, Any]]) -> int:
    """Send metric data to CloudWatch and return the number of emitted metrics."""

    items = [dict(metric) for metric in metrics]
    for start in range(0, len(items), MAX_PUT_METRIC_DATA_ITEMS):
        batch = items[start : start + MAX_PUT_METRIC_DATA_ITEMS]
        if batch:
            cloudwatch.put_metric_data(Namespace=namespace, MetricData=batch)
    return len(items)
