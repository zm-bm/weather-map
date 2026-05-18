# Frontend Source Map

This document defines preferred domain terms and module ownership boundaries for
`frontend/src`.

## Terminology

Shared Weather Map vocabulary is defined in
[`../../docs/terminology.md`](../../docs/terminology.md). Use those definitions
when naming new modules, docs, types, and UI/domain concepts.

## Top-Level Flow

`App.tsx` owns routing. The forecast route calls
`forecast-bootstrap/useForecastBootstrap`, which fetches
`manifests/availability-index.json`, converts embedded latest data into a
renderable manifest, projects startup state into `app-status`, then renders
`components/ForecastShell`.

`ForecastShell` wires the main providers:

- `forecast-selection`: selected layer, selected particle layer, and unit options.
- `forecast-time`: selected valid time and playback state.

`components/ForecastMap` owns the MapLibre host instance and calls
`forecast-sync/useForecastSync`, which coordinates startup, request building,
payload loading, and layer application.

## Module Ownership

- `app-status/*`: global blocking/toast status state, priority selection, and host rendering inputs. Use this for cross-cutting load/error states that should surface above the app.

- `components/*`: React composition and panel/control UI. Components should consume domain contexts and hooks rather than owning payload decoding, MapLibre setup, or artifact fetching directly.

- `forecast-catalog/*`: user-facing layer catalog, particle layer catalog, layer groups, labels, color tables, display ranges, unit/legend behavior ids, and artifact or derived-source mappings.

- `forecast-selection/*`: selected layer, selected particle layer, and unit option state derived from the loaded manifest and frontend catalog. Keep layer selection concerns here, separate from time selection.

- `forecast-time/*`: valid-time selection, playback state, manifest time bounds, and formatting helpers. This layer should not know about artifact payload decoding or MapLibre runtime details.

- `forecast-availability/*`: fetch, parse, validate, and expose the global model/layer availability index. This is the only startup network request for forecast metadata.

- `forecast-bootstrap/*`: forecast app initialization, availability request state, availability-to-manifest conversion, active model state, and startup status projection.

- `manifest/*`: parse, validate, and expose renderable forecast manifests. Manifests describe artifact availability, decode metadata, time-slice payload refs, and model/run identity, not UI layer taxonomy.

- `forecast-artifacts/*`: manifest artifact I/O and decoding. This module resolves artifact payload refs, fetches and caches payload bytes, validates payload size, and decodes scalar/vector artifact data.

- `forecast-data/*`: selected forecast target loading, interpolation windows, layer source-recipe loading, particle data loading, reuse-key memory, and prefetching. This module translates catalog selections plus decoded artifacts into renderable field/particle interpolation windows.

- `forecast-cache/*`: byte-limited memory and IndexedDB payload cache. Keep eviction, scope changes, and pending writes here so data/layer code can treat cache reads and writes as an implementation detail.

- `forecast-sync/*`: orchestration layer for startup policy, forecast target composition, abort/dedupe, data loading, layer updates, field-data publication, and app-status projection. It should coordinate modules, not decode payload formats or own interpolation-window reuse bookkeeping itself.

- `forecast-render/*`: forecast renderer adapters, controllers, shaders, and renderer-specific options. This module should install MapLibre custom layers and apply already-loaded interpolation windows only; data loading and probe behavior live elsewhere.

- `map/*`: MapLibre host platform, style construction, viewport persistence, map controls, and base map interactions. Keep forecast domain logic out of this layer.

- `forecast-probe/*`: public probe facade, layer point samplers, current applied field-data store, and probe-value formatting. `forecast-sync` publishes applied field interpolation windows, and map label components read sampled values through the public facade.

- `units/*`: unit conversion and formatting primitives shared by UI and probe display.

- `url/*`: URL joining and related URL utilities.

- `styles/*`: global CSS split by surface area. Import through `styles/index.css`.

- `test/*`: shared test setup and fixtures for manifests, map stubs, payloads, provider wrappers, IndexedDB, and abort signals.

## Coordination Pattern

Preferred orchestration shape:

1. `ForecastApp` loads availability through `useForecastBootstrap` and owns top-level app status projection for startup.
2. `ForecastShell` installs selection and time providers around map and panel UI.
3. `ForecastMap` owns MapLibre lifecycle through `map/useMap`.
4. `forecast-sync/useForecastSync` turns provider state into a `ForecastSyncTarget`.
5. `forecast-sync/useSyncRunner` loads target data through `forecast-data`, applies it through `forecast-render`, then publishes the applied field interpolation window through `forecast-probe`.
6. `forecast-render/*` adapters/controllers apply forecast renderer changes to the map host.

Guideline: keep durable domain state in the relevant provider module, use
`forecast-sync` for cross-domain coordination, keep forecast data loading inside
`forecast-data`, keep probe sampling inside `forecast-probe`, and keep
renderer/runtime details inside `forecast-render` and `map`.
