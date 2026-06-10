# Weather Map Terminology

Defines the shared semantic vocabulary for Weather Map.

Use this file to distinguish user-facing layer concepts from forecast product
config, ETL artifacts, forecast time concepts, render layers, and MapLibre
implementation details. For detailed forecast config editing rules, see
`forecast-config.md`.

## Layer Terms

- `forecast`: the app domain for manifests, time selection, layer selection,
  artifact loading, rendering, and probe display.
- `dataset` / `dataset_id`: a configured data product such as GFS, ICON,
  radar, or satellite imagery. A dataset can have many cycles.
- `layer`: a user-facing forecast choice from the frontend catalog, such as
  Temperature, Wind Speed, or Precipitation Rate. Selectable filled layers are
  cataloged as `rasterLayers`.
- `layer source`: a catalog raster recipe describing how a raster layer obtains data.
  A source names one backing artifact and one or more output bands. Direct
  scalar layers use `value`, wind-speed layers use ordered `u/v` bands, and
  cloud layers use ordered `low/middle/high` bands. Source bands describe data
  loading only; display colors live in display profiles.
- `particle layer`: a user-facing animated particle visualization choice,
  separate from raster-rendered layers. The current particle layer is wind
  particles.
- `overlay`: a non-selectable render addition attached to a selected layer or
  enabled by map options. Examples are precipitation-type patterns and pressure
  contours. The `overlay` render layer is specifically the layer-attached
  overlay renderer; pressure contours use the separate `contour` render layer.
- `catalog` / `catalog.json`: the product/frontend presentation contract. It
  lists `rasterLayerGroups`, `rasterLayers`, overlay layers, contour layers,
  particle layers, display-profile references, and artifact source recipes.
  The first id in a group's `rasterLayerIds` list is the group default.
- `display profile`: frontend display metadata referenced by raster layers.
  A display profile owns the label, display range, unit options, legend labels,
  and palette colors for one or more layers.
- `palette` / `colortable`: a display-owned mapping from scalar magnitude to
  color.

## Time Terms

- `cycle`: UTC batch/window/source issue timestamp, formatted as `YYYYMMDDHH`.
- `run` / `run_id`: one ETL attempt to produce and publish a dataset cycle. A
  cycle can have multiple runs; an explicit run id resumes one run.
- `frame_id`: the within-cycle time/index dimension, formatted as `000`,
  `001`, `003`, etc. for forecast datasets.
- `frame worker`: the ETL execution unit for one dataset/cycle/run/frame. A
  frame worker reads source data and writes the selected artifact payloads plus
  completion markers for that frame.
- `valid time`: the actual UTC forecast time represented in the UI.
- `frame`: one discrete forecast data time in the frontend: one active run plus
  one lead-hour token. This is the preferred data/render term.
- `interpolation window`: the lower frame, upper frame, and interpolation mix
  used for continuous valid-time rendering.
- `time slice`: older/general term for a discrete forecast data time. Prefer
  `frame` in data/render code and docs. Some time-domain type names may still
  use `TimeSlice` where they describe selected time state rather than loaded
  renderer data.

## Artifact Terms

- `pipeline` / `pipeline.json`: the ETL production contract. It defines
  dataset sources, frame workloads, artifact specs, source selectors, and
  derivations.
- `dataset source` / `source type`: the ETL acquisition family and settings for
  one dataset, such as `gfs_nomads` or `icon_dwd_icosahedral`. This is distinct
  from a frontend layer source recipe.
- `product config`: the paired forecast configuration formed by loading
  `pipeline.json` and `catalog.json` together and validating that the catalog's
  artifact/band requirements match what the pipeline can publish.
- `artifact catalog`: the `pipeline.json.artifact_catalog` section defining
  artifact ids, kind, component order, units, transforms, and encoding. This is
  distinct from `catalog.json`.
- `workload`: the dataset-specific frame range and artifact set the ETL plans
  for a cycle run.
- `artifact`: an ETL-produced payload advertised by the manifest, with decode
  metadata used by the frontend artifact loader.
- `artifact payload`: the encoded binary bytes for one artifact at one frame.
- `scalar artifact`: an artifact containing one gridded value per cell.
- `vector artifact`: an artifact containing multiple ordered component grids.
  Some vectors are physical `u/v` vectors, while others are component bundles
  such as `snow_frac` / `mix_frac`.
- `manifest`: the artifact availability and decode contract for a dataset run.
  It describes artifacts, grids, encodings, available frames, and run identity;
  it does not define the user-facing layer taxonomy.
- `run manifest`: the immutable manifest for one dataset/cycle/run.
- `latest manifest` / `current manifest`: mutable public aliases that point
  consumers at the selected run for a dataset or cycle.
- `manifest index`: `manifests/index.json`, the frontend-facing product index
  built from product config plus latest manifests. It summarizes which catalog
  layers are available for each dataset.
- `status.json`: the root public ETL health document. ETL writes it from
  durable state; the backend reads it to serve `/api/health`.
- `frame ref`: the frontend artifact module's resolved reference to an artifact
  payload for one frame, including the manifest-provided payload path and byte
  length.

## Data Terms

- `forecast frames`: shared boundary types for encoded frames and forecast
  windows. Sync, render, and place probes consume these frame shapes
  without depending on each other's implementation modules.
- `catalog source`: pure catalog-owned source schemas, inferred source types,
  and source helpers for raster bands across base raster layers, overlay
  layers, contour layers, and particle layers.
- `forecast loading`: executable frontend data path inside sync that executes
  resolved window plans, resolves artifact payloads, assembles encoded frames, builds
  lower/upper windows, reuses committed windows, and warms future frames
  through prefetch.
- `forecast sync plan`: the resolved active run, interpolation window, and source
  window plans needed by forecast loading. Sync builds the plan from catalog
  selection, time selection, active-run availability, and render feature
  options.
- `source descriptor`: a frontend descriptor that adapts selected catalog state
  into artifact ids, raster band ids, display profile data, and resolved
  overlays needed by window plans and render/probe consumers. Catalog sources
  use `{ artifactId, bands }`; selected `ForecastLayerSource` adds layer
  context, resolved display data, and resolved overlay entries.
- `window plan`: a sync-resolved forecast-window plan that names the output
  window id, request/cache identity, raster frame entries, band ids, and
  required/optional failure policy.
- `data frame` / `forecast frame`: a small frontend object for one loaded hour.
  Production frames carry a source descriptor plus an encoded raster payload;
  they do not contain full-grid decoded `Float32Array` values.
- `forecast window`: loaded lower and upper frames plus interpolation metadata
  for one render layer window.
- `encoded raster band`: one `Int8Array` of stored gridded values for a raster
  frame. Bands are ordered by artifact/component contract.
- `encoded raster frame`: one forecast-hour raster with one or more encoded
  bands plus grid, encoding, artifact id, and cache key metadata.
- `raw raster-band load`: artifact-loader API that hides scalar/vector payload
  shape and returns requested ordered `Int8Array` bands for encoded frame
  assembly.
- `raster layer frame`: one source descriptor plus one encoded raster frame.
  Window id routes the frame to a renderer; the source descriptor carries the
  selected catalog source meaning.
- `wind vector raster`: raw encoded ordered `u/v` bands used by particles and
  by raster wind-speed derivation. It does not itself compute wind speed.
- `probe window`: the base raster window published to place probes. It may
  represent a value-band raster, shader-derived wind speed, or cloud-layer coverage
  depending on the selected `ForecastLayerSource`.

## Rendering Terms

- `render layer`: a concrete frontend render surface and MapLibre custom layer.
  Current render layer ids are `raster`, `overlay`, `contour`, and `particles`.
- `raster render layer`: the base filled raster renderer for the selected
  catalog layer. It shades scalar, temperature-piecewise, wind-speed-derived,
  and cloud-layers sources from encoded raster frames.
- `overlay render layer`: a separate custom layer for overlays attached to the
  selected base layer. Current style: precipitation-type pattern.
- `contour render layer`: optional pressure contour renderer using raw encoded
  pressure frames plus GPU smoothing when available.
- `particles render layer`: optional animated particle renderer using raw
  encoded wind vector frames and a packed signed `RG8I` simulation texture.
- `MapLibre layer`: a MapLibre style or custom-layer primitive. Do not use plain
  `layer` for this in app/domain docs.

## Interaction Terms

- `sync`: orchestration that turns current app state into loaded forecast
  windows, applied render layers, and published probe data.
- `probe`: sampling the applied field at a map coordinate for labels and
  readouts.
