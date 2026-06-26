# Forecast Config

This folder defines what weather data the demo can produce and what layers the
app can show. There are two files:

- `pipeline.json` is the ETL side. It says which datasets exist, where their
  source data comes from, which frames to process, what artifacts to publish,
  how source fields are selected or derived, and how payloads are encoded.
- `catalog.json` is the app side. It says which layers appear in the UI, how
  they are grouped, and which artifact bands each raster, overlay, contour, or
  particle layer reads.

The loader reads both files together and checks that they line up. ETL workers
also snapshot both files into every run before frame jobs start, so a run stays
pinned to the config it was planned with even if the repo or deployed config
changes later.

## Terms

A few config and ETL terms show up everywhere:

- `dataset` / `dataset_id`: a configured data product, such as GFS, ICON, or
  MRMS observed radar.
- `cycle`: UTC source issue timestamp, formatted as `YYYYMMDDHH`.
- `run` / `run_id`: one ETL attempt to produce and publish a dataset cycle.
- `frame_id`: the frame identifier inside a cycle/run. Forecast datasets use
  lead-hour ids such as `000`; rolling observed datasets such as MRMS use UTC
  timestamp ids such as `YYYYMMDDHHMMSS`.
- `workload`: the ETL-planned frame/artifact set for a forecast dataset.
  Rolling observed datasets may resolve recent source timestamps instead.
- `frame worker`: the ETL unit that processes one dataset/cycle/run/frame.
- `product config`: the validated pair of `pipeline.json` and `catalog.json`.
- `artifact catalog`: the `pipeline.json.artifact_catalog` section.
- `artifact`: an ETL-produced scalar or vector payload advertised by a
  manifest and loaded by the app.
- `manifest`: artifact availability and decode metadata for a dataset run.
- `latest manifest` / `current manifest`: mutable public aliases that point
  consumers at the selected run.
- `manifest index`: `manifests/index.json`, the app-facing product index built
  from product config plus latest manifests.

## What Goes Where

Use `pipeline.json` for data-production details:

- `artifact_catalog`: artifact ids, scalar/vector kind, component order,
  units, source transforms, encoding, nodata, and ranges.
- `datasets`: source type/settings, frame workload, published artifacts, source
  selectors, derivations, and grid transforms for each dataset.

Use `catalog.json` for UI/product exposure:

- `rasterLayerGroups`: browse groups and default raster-layer ordering.
- `rasterLayers`: selectable filled layers and their artifact band recipes.
- `overlayLayers`: layer-attached optional render additions.
- `contourLayers`: map-option contour renderers.
- `particleLayers`: animated vector renderers.

As a rule of thumb: if it affects what bytes get fetched, derived, encoded, or
published, it belongs in `pipeline.json`. If it affects what the user can pick
or how a layer is presented, it belongs in `catalog.json` or frontend display
code.

## Cross-Checks

The loader checks the important cross-file links:

- Every catalog `source.artifactId` exists in `pipeline.json.artifact_catalog`.
- Every catalog source band id matches the artifact component ids exactly.
- Required raster-layer artifacts are present in a dataset workload before that
  layer is advertised for the dataset.
- Overlay references point to catalog overlay ids.
- Optional overlays may be unavailable without blocking the parent layer.
- Manifest generation and status generation use the same loaded product config,
  so public manifests and `manifests/index.json` are checked against the same
  catalog requirements.

Treat the JSON files as the current layer/dataset support table. Hand-maintained
support lists in docs drift fast.

## Changing Things

When adding or changing a layer, this order usually keeps things sane:

1. Start with `pipeline.json`.
   - Update `artifact_catalog` for artifact ids, components, units, transforms,
     and encoding.
   - Update each dataset's `artifacts`, derivations, and workload when that
     dataset publishes the artifact.
2. Then update `catalog.json`.
   - Add raster, overlay, contour, or particle source recipes with artifact id
     and ordered bands.
   - Keep frontend-only display choices out of the ETL artifact definitions.
3. Run the focused checks before publishing new artifacts.

Focused checks:

```bash
cd etl && ../.venv/bin/python -m pytest tests/config tests/state/manifest
cd etl && ../.venv/bin/ruff check weather_etl/config tests/config
```
