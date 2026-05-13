"""Build frontend manifest sections from product success markers."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Iterable, Mapping

from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ProductSpec
from ..cycles import cycle_datetime
from ..validation import validated_dict
from .constants import (
    FORECAST_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from .marker_inputs import product_manifest_inputs_from_markers
from .revision import compute_manifest_revision
from .schema import (
    ManifestProduct,
    cycle_manifest,
    manifest_time,
)


def build_manifest_products(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    fhours: Iterable[str],
    product_ids: Iterable[str],
    products: Mapping[str, ProductSpec],
) -> dict[str, dict[str, Any]]:
    """Build manifest product entries from success markers and product config."""

    manifest_products: dict[str, dict[str, Any]] = {}
    fhours = tuple(str(fhour) for fhour in fhours)

    for product_id in product_ids:
        product = products.get(product_id)
        if product is None:
            raise SystemExit(f"Missing product config for product {product_id!r}")

        marker_inputs = product_manifest_inputs_from_markers(
            artifacts=artifacts,
            model_id=model_id,
            cycle=cycle,
            fhours=fhours,
            product_id=product_id,
            product=product,
        )
        product_entry: dict[str, Any] = {
            "id": product_id,
            "kind": product.kind,
            "units": product.units,
            "parameter": product.parameter,
            "level": product.level,
            "components": product.component_ids,
            "grid": marker_inputs.grid,
            "encoding": marker_inputs.encoding,
            "frames": marker_inputs.frames,
        }
        if product.temporal is not None:
            product_entry["temporalKind"] = product.temporal.kind
            if product.temporal.source_interval_hours is not None:
                product_entry["sourceIntervalHours"] = product.temporal.source_interval_hours
        manifest_products[product_id] = validated_dict(
            ManifestProduct,
            product_entry,
            by_alias=True,
            exclude_none=True,
        )

    return manifest_products


def build_cycle_manifest(
    *,
    model_id: str,
    model_label: str,
    cycle: str,
    generated_at: str,
    fhours: Iterable[str],
    products: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Build a complete cycle manifest and compute its stable revision."""

    run = {
        "cycle": cycle,
        "generatedAt": generated_at,
    }
    manifest_obj = {
        "schema": MANIFEST_SCHEMA,
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "payloadContract": FORECAST_BINARY_CONTRACT,
        "model": {
            "id": model_id,
            "label": model_label,
        },
        "run": run,
        "times": _manifest_times(cycle=cycle, fhours=fhours),
        "products": products,
    }
    run["revision"] = compute_manifest_revision(manifest_obj)
    return cycle_manifest(manifest_obj)


def _manifest_times(*, cycle: str, fhours: Iterable[str]) -> list[dict[str, object]]:
    """Build manifest time entries from a cycle and forecast-hour ids."""

    cycle_dt = cycle_datetime(cycle)
    times: list[dict[str, object]] = []
    for fhour in fhours:
        lead_hours = int(fhour)
        times.append(
            manifest_time(
                fhour=fhour,
                lead_hours=lead_hours,
                valid_at=(cycle_dt + timedelta(hours=lead_hours)).isoformat().replace("+00:00", "Z"),
            )
        )
    return times
