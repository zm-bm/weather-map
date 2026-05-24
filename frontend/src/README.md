# Frontend Source Map

This document defines preferred domain terms and module ownership boundaries for
`frontend/src`.

## Terminology

Shared Weather Map vocabulary is defined in
[`../../docs/terminology.md`](../../docs/terminology.md). Use those definitions
when naming new modules, docs, types, and UI/domain concepts.

## Top-Level Flow

`app/App.tsx` owns routing. The forecast route calls
`forecast/manifest/useForecastManifest`, which fetches
`manifests/forecast-manifest.json`, selects the active model, composes app
startup status, then renders `forecast/ui/ForecastShell` and
`app/AppStatusHost`.

`ForecastShell` wires the main providers:

- `forecast/selection`: selected layer, selected particle layer, and unit options.
- `forecast/time`: selected valid time and playback state.
- `forecast/settings`: map presentation settings and render feature options.

`forecast/ui/ForecastMap` owns the MapLibre host instance, installs the forecast
renderer host after map style readiness, bridges forecast settings into renderer
and sync setup, and calls `forecast/sync/useForecastSync`, which coordinates
startup, request building, payload loading, and layer application.

## Module Ownership

- `app/*`: route composition, forecast app startup status projection, app status rendering, and non-forecast routes such as health.

- `forecast/ui/*`: React composition and panel/control UI for the forecast route. UI should consume domain contexts and hooks rather than owning payload decoding, MapLibre setup, or artifact fetching directly.

- `forecast/catalog/*`: user-facing layer catalog, particle layer catalog, layer groups, labels, color palettes, display ranges, and artifact or derived-source mappings. Catalog entries reference unit and legend behavior contracts owned by `forecast/units` and `forecast/legend`.

- `forecast/selection/*`: selected layer, selected particle layer, and unit option state derived from the loaded manifest and frontend catalog. Keep layer selection concerns here, separate from time selection.

- `forecast/time/*`: valid-time selection, playback state, manifest time bounds, and formatting helpers. This layer should not know about artifact payload decoding or MapLibre runtime details.

- `forecast/manifest/*`: fetch, parse, validate, and expose the public forecast manifest. This owns startup request state, active model state, model/layer availability helpers, and artifact payload path resolution. It is the only startup network request for forecast metadata.

- `forecast/artifacts/*`: manifest artifact I/O and decoding. This module resolves artifact payload refs, fetches and caches payload bytes, validates payload size, and decodes scalar/vector artifact data.

- `forecast/data/*`: semantic forecast data contracts plus a per-runtime data session. It owns `ForecastDataTarget`, loaded-data contracts, request keys, reusable-window memory, prefetch scheduling, loaded data-window composition, and private artifact-backed slice loaders/materialization.

- `forecast/cache/*`: byte-limited memory and IndexedDB payload cache. Keep eviction, scope changes, and pending writes here so data/layer code can treat cache reads and writes as an implementation detail.

- `forecast/sync/*`: runtime coordination for startup policy, current target resolution, abort/dedupe, data loading, render-host application, probe-frame publication, timeline notification, and sync startup state. It should coordinate modules, not decode payload formats, construct artifact loaders, know about MapLibre, project app status, or own interpolation-window reuse bookkeeping itself.

- `forecast/settings/*`: React-owned map presentation settings and defaults. This module owns user-facing render feature options and should stay independent of UI, renderer, map-view, and sync internals.

- `forecast/render/*`: imperative renderer runtime, renderer profiles, adapters, controllers, and shaders. This module owns MapLibre custom layer reconciliation and exposes a render-host apply capability; settings state, data loading, and probe behavior live elsewhere.

- `forecast/place-probes/*`: forecast place-probe feature orchestration, including visible place selection, field sampling, label creation, MapLibre source/layer updates, hover state, and viewport refresh handling. React UI wraps this feature but does not own the session behavior.

- `forecast/palette/*`: shared palette stop contract and frontend palette registry used by catalog display, legend gradients, and field renderer LUT input.

- `forecast/legend/*`: legend scale behavior, tick generation, and gradient helpers shared by forecast display UI.

- `forecast/units/*`: unit behavior contracts, conversion, and formatting primitives shared by UI and probe display.

- `map/*`: MapLibre host platform, basemap contracts, style construction, viewport persistence, map controls, and base map interactions. Keep forecast domain logic out of this layer.

- `core/*`: dependency-light primitives such as config, abort/error helpers, math, geo, URL joining, keyboard helpers, and shared type helpers. Keep this precise; do not turn it into a utility bucket.

- `radio/*`: audio playlist/player behavior used by map controls.

- `styles/*`: global CSS split by surface area. Import through `styles/index.css`.

- `assets/*`: static frontend assets.

- `test/*`: shared test setup and fixtures for manifests, map stubs, payloads, provider wrappers, IndexedDB, and abort signals.

## Coordination Pattern

Preferred orchestration shape:

1. `ForecastApp` loads the forecast manifest through `useForecastManifest` and owns top-level app status projection.
2. `ForecastShell` installs selection, time, and settings providers around map and panel UI.
3. `ForecastMap` owns MapLibre lifecycle through `map/useMap` and bridges
   `forecast/settings` to `forecast/render` and `forecast/sync`.
4. `forecast/sync/useForecastSync` resolves the current catalog/time selection into a data target plus timeline request callbacks,
   waits for a render host capability, exposes sync startup state, and publishes applied probe frames through a callback.
5. `forecast/sync/useRequestRunner` creates data-session load jobs, applies loaded data through the render host, publishes the applied probe frame, commits successful jobs, and notifies the timeline.
6. `forecast/render/*` reconciles active renderer profiles and applies already-loaded data windows to MapLibre custom layers.

Guideline: keep durable domain state in the relevant provider module, use
`forecast/sync` for cross-domain coordination and target resolution, keep slice
loading and request/window orchestration behind the `forecast/data` session,
keep `forecast/data/loaders` private, keep field sampling and place-probe
orchestration inside `forecast/place-probes`, and keep renderer/runtime details
inside `forecast/render` and `map`.
