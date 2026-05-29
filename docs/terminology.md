# Weather Map Terminology

Defines the shared semantic vocabulary for Weather Map.

Use this file to distinguish user-facing layer concepts from ETL artifacts,
forecast time concepts, render layers, and MapLibre implementation details.

## Layer Terms

- `forecast`: the app domain for manifests, time selection, layer selection,
  artifact loading, rendering, and probe display.
- `model`: a configured forecast source such as GFS or ICON. A model can have
  many cycles.
- `layer`: a user-facing forecast choice from the frontend catalog, such as
  Temperature, Wind Speed, or Precipitation Rate. Selectable filled layers are
  cataloged as `rasterLayers`.
- `layer source`: a catalog raster recipe describing how a raster layer obtains data.
  A source names one backing artifact and one or more output bands. Direct
  scalar layers use `value`, wind-speed layers use ordered `u/v` bands, and
  cloud layers use ordered `low/middle/high` bands. Base layer bands also carry
  palette ids.
- `particle layer`: a user-facing animated particle visualization choice,
  separate from raster-rendered layers. The current particle layer is wind
  particles.
- `overlay`: a non-selectable render addition attached to a selected layer or
  enabled by map options. Examples are precipitation-type patterns and pressure
  contours. The `overlay` render layer is specifically the layer-attached
  overlay renderer; pressure contours use the separate `contour` render layer.
- `forecast catalog`: the frontend-owned list of `rasterLayerGroups`,
  `rasterLayers`, overlay layers, contour layers, particle layers, grouped
  display metadata, palettes, and source recipes. The first id in a group's
  `rasterLayerIds` list is the group default. The catalog package owns JSON
  schema validation and normalized catalog entries; active-run/palette-enriched
  display info is built outside the catalog package.
- `palette` / `colortable`: a catalog-owned display mapping from scalar
  magnitude to color.

## Time Terms

- `cycle`: model run initialization timestamp, formatted as `YYYYMMDDHH`.
- `lead hour` / `hour token`: forecast offset from the cycle, formatted as
  `000`, `001`, `003`, etc.
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

- `artifact catalog`: the ETL-owned config defining which artifacts the ETL
  produces. This is distinct from the frontend-owned forecast catalog.
- `artifact`: an ETL-produced payload advertised by the manifest, with decode
  metadata used by the frontend artifact loader.
- `artifact payload`: the encoded binary bytes for one artifact at one frame.
- `scalar artifact`: an artifact containing one gridded value per cell.
- `vector artifact`: an artifact containing multiple ordered component grids.
  Some vectors are physical `u/v` vectors, while others are component bundles
  such as `snow_frac` / `mix_frac`.
- `manifest`: the artifact availability and decode contract for a model run. It
  describes artifacts, grids, encodings, available forecast times, and run
  identity; it does not define the user-facing layer taxonomy.
- `frame ref`: the frontend artifact module's resolved reference to an artifact
  payload for one forecast hour, including the inferred payload path and byte
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
  into artifact ids, display metadata, raster band ids, and raster band palettes
  needed by window plans and render/probe consumers. Catalog sources use
  `{ artifactId, bands }`; selected `ForecastLayerSource` adds layer context,
  display range, and resolved overlay entries.
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
