"""Per-item worker pipeline.

The worker is responsible for running GDAL steps for a single work item
(cycle + forecast hour + layer):
- fetch source GRIB (via UriStore)
- select band by metadata
- translate/warp/shade
- build MBTiles
- publish MBTiles to the artifact root (file:// or s3://)
- write a success marker JSON
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from . import gdal_ops
from .config import ExecutionContext
from .contracts import ArtifactPaths, WorkItem
from .stores import make_store
from .proc import make_runner


def _write_colortable(path: Path, layer: dict) -> None:
    """Write a gdaldem color-relief table file for the configured layer."""
    text = gdal_ops.format_color_relief_table(
        colortable=layer["colortable"],
        scale_min=float(layer["scale_min"]),
        scale_max=float(layer["scale_max"]),
    )
    path.write_text(text, encoding="utf-8")


def _run_item_in_workdir(
    *,
    workdir: Path,
    ctx: ExecutionContext,
    item: WorkItem,
    layer: dict,
    store,
    run: gdal_ops.RunFn,
) -> str:
    """Run pipeline steps inside `workdir`.

    Returns the published MBTiles URI.
    """

    # Get source GRIB file
    grib_path = workdir / "input.grib2"
    store.get_to_file(uri=item.source_uri, dst=grib_path)

    # Find GRIB band index
    grib_match = layer.get("grib_match")
    if isinstance(grib_match, dict):
        grib_band_idx, _ = gdal_ops.find_grib_band_by_metadata(grib_path, grib_match, run=run)
    else:
        raise SystemExit(f"Layer {item.layer} must define grib_match")

    # Translate GRIB band to raw GeoTIFF
    tif_raw = workdir / "raw.tif"
    gdal_ops.gdal_translate(
        grib_path,
        tif_raw,
        opts=gdal_ops.TranslateOpts(
            band=grib_band_idx,
            scale_min=float(layer.get("scale_min")),
            scale_max=float(layer.get("scale_max")),
            output_type="Byte",
            output_format="GTiff",
            a_nodata="none",
        ),
        run=run,
    )

    # Warp to Web Mercator XYZ
    tif_3857 = workdir / "mercator.tif"
    gdal_ops.warp_web_mercator_xyz(
        tif_raw,
        tif_3857,
        max_zoom=int(ctx.gdal.max_zoom),
        resampling=str(ctx.gdal.warp_resampling),
        run=run,
    )

    # Apply color relief
    colortable_path = workdir / "color.txt"
    _write_colortable(colortable_path, layer)
    tif_shaded = workdir / "shaded.tif"
    gdal_ops.gdaldem_color_relief(tif_3857, colortable_path, tif_shaded, nearest_color_entry=True, run=run)

    # Translate to MBTiles
    mbtiles_path = workdir / "out.mbtiles"
    if mbtiles_path.exists():
        mbtiles_path.unlink()
    gdal_ops.translate_to_mbtiles_png(
        tif_shaded,
        mbtiles_path,
        name=f"{item.layer} {item.cycle} {item.fhour}",
        tile_format=str(ctx.gdal.tile_format),
        zoom_level_strategy=str(ctx.gdal.zoom_level_strategy),
        run=run,
    )

    # Add overviews to MBTiles
    gdal_ops.add_mbtiles_overviews(
        mbtiles_path,
        min_zoom=int(ctx.gdal.min_zoom),
        max_zoom=int(ctx.gdal.max_zoom),
        resampling=str(ctx.gdal.overview_resampling),
        run=run,
    )

    # Publish MBTiles
    ap = ArtifactPaths(ctx.artifact_root_uri)
    mbtiles_uri = ap.output_mbtiles_uri(item)
    store.put_file(uri=mbtiles_uri, src=mbtiles_path)
    return mbtiles_uri


def run_worker(ctx: ExecutionContext, item: WorkItem, *, layers_cfg: dict) -> None:
    """Run the full pipeline for one WorkItem and publish its artifacts."""
    if item.layer is None:
        raise SystemExit("WorkItem.layer is required to build MBTiles")

    layer = layers_cfg.get(item.layer) if isinstance(layers_cfg, dict) else None
    if not layer:
        raise SystemExit(f"Unknown layer: {item.layer}")

    store = make_store()
    run = make_runner()

    with tempfile.TemporaryDirectory(prefix="gfs-work-") as td:
        mbtiles_uri = _run_item_in_workdir(
            workdir=Path(td),
            ctx=ctx,
            item=item,
            layer=layer,
            store=store,
            run=run,
        )

        ap = ArtifactPaths(ctx.artifact_root_uri)
        success_uri = ap.success_marker_uri(item)
        store.write_bytes(
            uri=success_uri,
            data=(json.dumps(
                {"cycle": item.cycle, "fhour": item.fhour, "layer": item.layer, "mbtiles_uri": mbtiles_uri},
                sort_keys=True,
            ) + "\n").encode("utf-8"),
        )

    print(f"Done. Published MBTiles to: {mbtiles_uri}", flush=True)
