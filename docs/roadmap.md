# Weather Map Roadmap

Last updated: 2026-05-24

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

### 3. Add NEXRAD Observed Radar

Add observed radar as a separate source family, not as a normal forecast model
layer.

Start with `nexrad_reflectivity`, but settle source, payload, cache, and time
semantics before adding catalog UI. Observed radar should be clearly labeled as
observed data and should not be confused with forecast reflectivity.

Key decisions:

- whether radar uses raster tiles, artifact-backed grids, or another payload
  shape
- whether radar uses the forecast timeline, a recent-observed timeline, or a
  hybrid control
- cache scope and refresh behavior for recent observed data
- how observed radar coexists with model reflectivity and storm layers

### 4. Add Forecast Model Expansion Track

Plan support for additional forecast models such as HRRR and ECMWF.

Treat this as source/model expansion first, not just adding new catalog rows.
The work should define model ids, run availability, artifact mapping, and
layer-support compatibility before exposing model selection in the UI.

Initial models:

- HRRR
- ECMWF

Key decisions:

- model/run availability and forecast-hour coverage
- field mapping into the existing artifact contracts
- which current layers each model can support
- whether model selection should be global, per-layer, or hidden until support
  is broad enough

### 5. Add ETL Health Notifications

Add low-noise notifications when ETL health is stale, failing, or otherwise
requires attention.

Start with failure and staleness notifications. Avoid success notifications
unless they are opt-in or otherwise low-noise.

## Design Evaluations

### Evaluate MapLibre-Level Options

Decide whether map-level options such as globe projection or drag rotation
belong in the app UI.

Treat this as app design plus renderer validation, not just adding toggles.

### Evaluate Field Payload Strategy

Evaluate delta or predictive field encoding only if real payload or cost data
shows current compression and caching are not enough.

Consider breaking global fields into gridded chunks if viewport-scoped fetches
become more important than whole-frame simplicity.

## Layer Candidates

- Low-priority forecast layer candidates:
  `wind_direction`, `fog_low_visibility`, and `thunderstorm_overlay`.
  These fit the current forecast surface, but should wait until the core layer
  experience is polished.
- Future accumulation and upper-air candidates:
  `precip_accum_1h`, `precip_accum_3h`, `precip_accum_6h`,
  `precip_accum_12h`, `precip_accum_24h`, `snowfall_accumulation`,
  `cloud_ceiling`, `jet_stream`, `geopotential_height_500mb`,
  `upper_air_standard_levels`, and `storm_relative_helicity`.
  These need source confirmation, artifact contracts, or catalog design before
  implementation.
- Parked external product ideas:
  satellite, air quality, watches and warnings, lightning, and waves.
  Revisit these only after the app has a clearer external-source architecture.
