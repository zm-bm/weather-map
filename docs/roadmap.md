# Weather Map Roadmap

Last updated: 2026-05-24

This roadmap tracks the next meaningful app and engineering directions for
Weather Map. It is intentionally concise: use it to decide what matters next,
then create a focused implementation plan when a task is ready to execute.

## Next Priorities

### 1. Audit Default Palette And Boundary Correctness

Confirm that every field-rendered layer maps decoded physical values to the
right visual output after the encoding contract is sound.

This is the frontend/rendering contract. It covers default palette selection,
color stops, display range, unit behavior, legend scale, legend ticks, sampling
mode, and boundary handling.

Key work:

- audit every field-rendered layer's `paletteId`, color stops, display range,
  unit behavior, legend scale, and expected legend ticks
- define boundary semantics for continuous and threshold palettes
- add exact-boundary checks for values just below, exactly at, and just above
  every color stop
- verify behavior below display minimum, above display maximum, and for nodata
- make pure palette sampling, LUT generation, legend rendering, and catalog
  validation agree on the same contract

This should answer: does the app show the right colors for the right values?

### 2. Design Custom Palette Overrides

Design user-defined color palettes as a frontend feature built on top of the
display and encoding contracts above.

Start with the data model and rendering contract before adding UI.

Key work:

- formalize a palette schema with color stops, alpha, and sampling mode
- resolve each layer's active palette from default catalog metadata plus any
  user override
- feed the same resolved palette to the renderer and legend
- store user overrides per layer, initially in local browser storage
- validate or warn when custom stops are finer than artifact encoding
  resolution
- add a compact editor for palette preset, stop values, colors, opacity, and
  reset-to-default

This should answer: can users safely customize layer color palettes without
breaking legends, units, or renderer boundary behavior?

### 3. Add Selected Forecast Rendering Controls

Expose a small, useful set of runtime controls in the map options UI.

This should be a curated app control surface, not a debug panel. Good
candidates are controls that are safe to adjust live and easy to understand,
such as field opacity/intensity or particle density/speed.

### 4. Add NEXRAD Observed Radar

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

### 5. Add Forecast Model Expansion Track

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

### 6. Add ETL Health Notifications

Add low-noise notifications when ETL health is stale, failing, or otherwise
requires attention.

Start with failure and staleness notifications. Avoid success notifications
unless they are opt-in or otherwise low-noise.

## Recently Completed

### Define Field Layer Requirements

Created `forecast-field-layer-requirements.md` as a staging contract for
field-rendered layer units, display ranges, encoded ranges, precision,
thresholds, nodata behavior, clipping behavior, and sampling expectations.

### Audit Artifact Encoding Correctness

Added explicit ETL finite clamp support, updated artifact encoding contracts,
and added encoding-contract tests that lock range, quantum, nodata, clamp, and
boundary behavior for field-rendered artifacts.

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
