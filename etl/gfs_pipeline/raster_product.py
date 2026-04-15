"""Legacy raster product execution helpers.

This module is intentionally dormant in the scalar/wind runtime pipeline. It
is kept only as a reference implementation for historical MBTiles generation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Mapping

from . import gdal_ops
from .config import ExecutionContext
from .contracts import ArtifactPaths, WorkItem
from .stores.base import UriStore


def _write_colortable(path: Path, layer: Mapping[str, object]) -> None:
    """Write a gdaldem color-relief table file for the configured layer."""
    text = gdal_ops.format_color_relief_table(
        colortable=layer["colortable"],
        scale_min=float(layer["scale_min"]),
        scale_max=float(layer["scale_max"]),
    )
    path.write_text(text, encoding="utf-8")


def run_raster_item_in_workdir(
    *,
    workdir: Path,
    ctx: ExecutionContext,
    item: WorkItem,
    layer: Mapping[str, object],
    store: UriStore,
    grib_path: Path,
    run: gdal_ops.RunFn,
) -> str:
    """Generate and publish one raster MBTiles artifact for a work item.

    Dormant path: not called by the active scalar/wind ETL pipeline.
    """

    # Reused workdirs (process-hour bundles) need fresh intermediates per layer.
    for stale in (workdir / "raw.tif", workdir / "mercator.tif", workdir / "shaded.tif", workdir / "out.mbtiles"):
        if stale.exists():
            stale.unlink()

    grib_match = layer.get("grib_match")
    if isinstance(grib_match, Mapping):
        grib_band_idx, _ = gdal_ops.find_grib_band_by_metadata(grib_path, grib_match, run=run)
    else:
        raise SystemExit(f"Layer {item.layer} must define grib_match")

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

    tif_3857 = workdir / "mercator.tif"
    gdal_ops.warp_web_mercator_xyz(
        tif_raw,
        tif_3857,
        max_zoom=int(ctx.gdal.max_zoom),
        resampling=str(ctx.gdal.warp_resampling),
        run=run,
    )

    colortable_path = workdir / "color.txt"
    _write_colortable(colortable_path, layer)
    tif_shaded = workdir / "shaded.tif"
    gdal_ops.gdaldem_color_relief(tif_3857, colortable_path, tif_shaded, nearest_color_entry=True, run=run)

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

    gdal_ops.add_mbtiles_overviews(
        mbtiles_path,
        min_zoom=int(ctx.gdal.min_zoom),
        max_zoom=int(ctx.gdal.max_zoom),
        resampling=str(ctx.gdal.overview_resampling),
        run=run,
    )

    ap = ArtifactPaths(ctx.artifact_root_uri)
    mbtiles_uri = ap.output_mbtiles_uri(item)
    store.put_file(uri=mbtiles_uri, src=mbtiles_path)
    return mbtiles_uri
