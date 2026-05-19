# Weather Map Roadmap

Last updated: 2026-05-19

This roadmap tracks the next meaningful app and engineering directions for
Weather Map. It is intentionally concise: use it to decide what matters next,
then create a focused implementation plan when a task is ready to execute.

## Next Priorities

### 1. Review Scalar Palettes And Boundary Correctness

Confirm that every field-rendered layer has the right color stops, unit
behavior, legend ticks, display range, and boundary handling.

Include exact-boundary checks for values on and around color stops.

### 2. Add Selected Forecast Rendering Controls

Expose a small, useful set of runtime controls in the map options UI.

This should be a curated app control surface, not a debug panel. Good
candidates are controls that are safe to adjust live and easy to understand,
such as field opacity/intensity or particle density/speed.

### 3. Evaluate MapLibre-Level Options

Decide whether map-level options such as globe projection or drag rotation
belong in the app UI.

Treat this as app design plus renderer validation, not just adding toggles.

## Forecast Layer Follow-Ups

### Proposed Catalog Items

Candidate additions to the canonical forecast layer registry belong here until
they are implemented and promoted into `forecast-layer-registry.md`.

- Fixed-window precipitation accumulation layers: `precip_accum_1h`,
  `precip_accum_3h`, `precip_accum_6h`, `precip_accum_12h`,
  `precip_accum_24h`.
- Explicit run-total precipitation layer if `accumulated_precipitation` remains
  useful after fixed-window accumulations exist.
- Pressure contours sourced from `prmsl_msl`.
- Fog or low-visibility emphasis layer using `visibility_surface` plus future
  supporting fields if needed.
- Upper-air layers at standard pressure levels: temperature, wind, height,
  humidity, and vorticity.
- External-source layer families: radar, satellite, air quality, watches and
  warnings, observed lightning, and waves.

### Thunderstorm Rendering

Decide how `thunderstorm_mask` should affect the `Precipitation Rate` composite
layer.

The artifact is ICON-only for now. Do not fake GFS thunder with CAPE,
reflectivity, or other storm proxies unless that tradeoff is explicitly chosen.
Prefer a subtle, bounded visual cue over dense glyphs or noisy overlays.

### Composite Cloud Layer

Consider reintroducing a combined Cloud Layers view as a frontend composite
recipe over `low_clouds`, `medium_clouds`, and `high_clouds`.

Do not bring back packed scalar artifacts. The individual cloud layers should
remain available even if a combined view is added.

### Precipitation Type Legend

Add a legend for the `Precipitation Type` layer that clearly indicates which colors
correspond to which precipitation types.

## Operational Follow-Ups

### ETL Health Notifications

Add low-noise notifications when ETL health is stale, failing, or otherwise
requires attention.

Start with failure and staleness notifications. Avoid success notifications
unless they are opt-in or otherwise low-noise.

## Architecture Follow-Ups

### Replace Mutable Renderer Option Singletons

Runtime renderer options are currently mutated through shared module-level
objects from the map controls. This hides state changes across UI, renderer
runtime, and tests.

Introduce explicit render settings state, likely through a small provider or
renderer controller API, so controls update settings and renderers consume those
settings through a clear boundary.

### Keep Status Projection Out Of Domain Modules

Startup status projection currently lives partly inside forecast domain modules,
which makes metadata loading responsible for app-status UI wiring.

Mount the status host at the app shell level and expose a small app-status source
hook or adapter. Forecast modules should expose load state; app composition
should decide how that state appears.

### Split Forecast Sync Targets From Timeline Callbacks

The sync target currently combines render data request identity with timeline
sync callbacks. That makes the runner carry both data-loading concerns and UI
timeline side effects in one object.

Separate the data target from timeline callbacks so request planning, rendering,
and time-state notification have clearer responsibilities.

### Promote Forecast Place Probes To A Feature Module

`components/ForecastPlaceProbes` owns more than React composition: it coordinates
forecast field data, probe sampling, visible place selection, MapLibre source
updates, and viewport events.

Move the session and sampler orchestration into a feature/domain module, leaving
the component as a thin React wrapper around that behavior.

### Invert Units And Catalog Dependency

The units module depends on forecast catalog types only to key unit behavior.
That makes a foundational formatting module depend on layer catalog structure.

Move the unit behavior type into `units` or a shared domain type, and have the
catalog reference it instead of the other way around.

## Ideas

- Evaluate delta or predictive field encoding only if real payload or cost data
  shows current compression and caching are not enough.
- Consider breaking global fields into gridded chunks if viewport-scoped fetches
  become more important than whole-frame simplicity.
- Add a Waves layer if a suitable NOAA wave source and artifact contract are
  identified.
