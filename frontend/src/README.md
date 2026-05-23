# Frontend Source Map

This document defines preferred domain terms and module ownership boundaries for
`frontend/src`.

## Terminology

Shared Weather Map vocabulary is defined in
[`../../docs/terminology.md`](../../docs/terminology.md). Use those definitions
when naming new modules, docs, types, and UI/domain concepts.

## Top-Level Flow

`App.tsx` owns routing. The forecast route calls
`forecast-manifest/useForecastManifest`, which fetches
`manifests/forecast-manifest.json`, selects the active model, composes app
startup status, then renders `components/ForecastShell` and
`components/AppStatusHost`.

`ForecastShell` wires the main providers:

- `forecast-selection`: selected layer, selected particle layer, and unit options.
- `forecast-time`: selected valid time and playback state.
- `forecast-settings`: map presentation settings and render feature options.

`components/ForecastMap` owns the MapLibre host instance, installs the forecast
renderer host after map style readiness, bridges forecast settings into renderer
and sync setup, and calls `forecast-sync/useForecastSync`, which coordinates
startup, request building, payload loading, and layer application.

## Module Ownership

- `components/*`: React composition and panel/control UI. Components should consume domain contexts and hooks rather than owning payload decoding, MapLibre setup, or artifact fetching directly. `components/AppStatusHost` owns the app status payload contract and rendering.

- `forecast-catalog/*`: user-facing layer catalog, particle layer catalog, layer groups, labels, color palettes, display ranges, and artifact or derived-source mappings. Catalog entries reference unit and legend behavior contracts owned by `units` and `forecast-legend`.

- `forecast-selection/*`: selected layer, selected particle layer, and unit option state derived from the loaded manifest and frontend catalog. Keep layer selection concerns here, separate from time selection.

- `forecast-time/*`: valid-time selection, playback state, manifest time bounds, and formatting helpers. This layer should not know about artifact payload decoding or MapLibre runtime details.

- `forecast-manifest/*`: fetch, parse, validate, and expose the public forecast manifest. This owns startup request state, active model state, model/layer availability helpers, and artifact payload path resolution. It is the only startup network request for forecast metadata.

- `forecast-artifacts/*`: manifest artifact I/O and decoding. This module resolves artifact payload refs, fetches and caches payload bytes, validates payload size, and decodes scalar/vector artifact data.

- `forecast-data-targets/*`: catalog/time adapters that translate selected layers, particle layers, and interpolation windows into data targets and source descriptors. This is the only data-loading layer that should know about catalog layer shapes.

- `forecast-data-loaders/*`: data load definitions, artifact capability checks, artifact-backed slice loading, materialization, data keys, and per-slice caches for field, cloud, precip-type, pressure, and wind-vector data.

- `forecast-data/*`: data request orchestration, interpolation-window loading, reusable-window memory, prefetch scheduling, and loaded data-window composition. This module consumes data sources plus loaders and exposes loaded meteorological data to sync/render/probe features.

- `forecast-cache/*`: byte-limited memory and IndexedDB payload cache. Keep eviction, scope changes, and pending writes here so data/layer code can treat cache reads and writes as an implementation detail.

- `forecast-sync/*`: orchestration layer for startup policy, data-target composition, abort/dedupe, data loading, render-host application, probe-frame publication, timeline notification, and sync startup state. It should coordinate modules, not decode payload formats, know about MapLibre, project app status, or own interpolation-window reuse bookkeeping itself.

- `forecast-settings/*`: React-owned map presentation settings and defaults. This module owns user-facing render feature options and should stay independent of component, renderer, map-view, and sync internals.

- `forecast-render/*`: imperative renderer runtime, renderer profiles, adapters, controllers, and shaders. This module owns MapLibre custom layer reconciliation and exposes a render-host apply capability; settings state, data loading, and probe behavior live elsewhere.

- `map/*`: MapLibre host platform, basemap contracts, style construction, viewport persistence, map controls, and base map interactions. Keep forecast domain logic out of this layer.

- `forecast-probe/*`: generic field probe sampling primitives. It should not own applied forecast state, unit/catalog formatting, or MapLibre place-label orchestration.

- `forecast-place-probes/*`: forecast place-probe feature orchestration, including visible place selection, label sampling, MapLibre source/layer updates, hover state, and viewport refresh handling. React components wrap this feature but do not own the session behavior.

- `forecast-palette/*`: shared palette stop contract and frontend palette registry used by catalog display, legend gradients, data payloads, and field renderer LUT input.

- `forecast-legend/*`: legend scale behavior, tick generation, and gradient helpers shared by forecast display UI.

- `units/*`: unit behavior contracts, conversion, and formatting primitives shared by UI and probe display.

- `url/*`: URL joining and related URL utilities.

- `styles/*`: global CSS split by surface area. Import through `styles/index.css`.

- `test/*`: shared test setup and fixtures for manifests, map stubs, payloads, provider wrappers, IndexedDB, and abort signals.

## Coordination Pattern

Preferred orchestration shape:

1. `ForecastApp` loads the forecast manifest through `useForecastManifest` and owns top-level app status projection.
2. `ForecastShell` installs selection, time, and settings providers around map and panel UI.
3. `ForecastMap` owns MapLibre lifecycle through `map/useMap` and bridges
   `forecast-settings` to `forecast-render` and `forecast-sync`.
4. `forecast-sync/useForecastSync` composes a data target plus timeline request callbacks,
   waits for a render host capability, exposes sync startup state, and publishes applied probe frames through a callback.
5. `forecast-sync/useRequestRunner` loads target data through `forecast-data`, which composes data targets with data loaders, applies them through the render host, publishes the applied probe frame, and notifies the timeline.
6. `forecast-render/*` reconciles active renderer profiles and applies already-loaded data windows to MapLibre custom layers.

Guideline: keep durable domain state in the relevant provider module, use
`forecast-sync` for cross-domain coordination, keep target adaptation in
`forecast-data-targets`, data-specific loading in `forecast-data-loaders`,
data orchestration in `forecast-data`, keep generic probe sampling inside `forecast-probe`, keep place
probe orchestration inside `forecast-place-probes`, and keep renderer/runtime
details inside `forecast-render` and `map`.
