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
`manifests/index.json`, selects the active dataset, composes app
startup status, then renders `forecast/ui/ForecastShell` and
`app/AppStatusHost`.

`ForecastShell` wires the main providers:

- `forecast/selection`: selected layer and selected particle layer.
- `forecast/time`: selected valid time and playback state.
- `forecast/settings`: map presentation settings, unit preference, and render feature options.

`forecast/ui/ForecastMap` owns the MapLibre host instance, installs the forecast
renderer host after map style readiness, bridges forecast settings into renderer
and sync setup, and calls `forecast/sync/useForecastSync`, which coordinates
initial sync, request building, payload loading, and layer application.

## Module Ownership

- `app/*`: route composition, forecast app startup status projection, app status rendering, and non-forecast routes such as health.

- `forecast/ui/*`: React composition and panel/control UI for the forecast route. UI should consume domain contexts and hooks rather than owning payload decoding, MapLibre setup, or artifact fetching directly.

- `forecast/catalog/*`: parsed and validated frontend catalog for user-facing raster layers, raster-layer groups, overlay layers, contour layers, particle layers, display-profile references, raster source metadata, and pure source helpers. Catalog source bands are load metadata only.

- `forecast/selection/*`: selected layer and selected particle layer derived from the loaded manifest and frontend catalog. Keep layer selection concerns here, separate from time selection and presentation settings.

- `forecast/time/*`: valid-time selection, playback state, manifest time bounds, and formatting helpers. This layer should not know about artifact payload decoding or MapLibre runtime details.

- `forecast/manifest/*`: fetch, parse, validate, and expose the public manifest index. This owns startup request state, active dataset state, and dataset/layer availability helpers. It is the only startup network request for forecast metadata.

- `forecast/artifacts/*`: manifest artifact I/O and raster-band loading. This module resolves artifact payload paths/refs, fetches and caches frame payload bytes, validates payload size, and returns ordered encoded raster bands from scalar or vector artifacts. Band lists stay generic through sync; render and probe consumers interpret source-band shapes such as `value`, `u/v`, and `low/middle/high`.

- `forecast/frames/*`: shared boundary types for encoded raster frames and forecast windows. Renderers, sync, and place probes depend on these frame shapes instead of importing each other's implementation modules.

- `forecast/cache/*`: generic byte-limited memory and IndexedDB cache infrastructure. Keep eviction, byte limits, and pending writes here; forecast-specific cache scope and keys belong with the artifact/sync owner using the cache.

- `forecast/sync/*`: runtime coordination for initial sync policy, current plan resolution, catalog-to-window-plan creation, abort/dedupe, forecast window loading, reusable-window memory, prefetch scheduling, render-host application, probe-frame publication, timeline notification, and initial sync state. Its internals are grouped as `plan`, `load`, and `request`. It should not decode physical values, know MapLibre internals, project app status, or interpret raster band styles after loading.

- `forecast/settings/*`: React-owned map presentation settings and defaults. This module owns unit preference and user-facing render feature options, and should stay independent of UI, renderer, map-view, and sync internals.

- `forecast/render/*`: imperative renderer runtime, renderer profiles, adapters, controllers, and shaders. This module owns MapLibre custom layer reconciliation and exposes a render-host apply capability; settings state, forecast loading, and probe behavior live elsewhere.

- `forecast/place-probes/*`: forecast place-probe feature orchestration, including visible place selection, raster sampling, label creation, MapLibre source/layer updates, hover state, and viewport refresh handling. React UI wraps this feature but does not own the session behavior.

- `forecast/display/*`: resolved raster-layer display profiles plus display-only helpers. Profiles own labels, display ranges, unit options, legend labels, and palettes; submodules provide unit conversion, legend layout, and palette sampling.

- `map/*`: MapLibre host platform, basemap contracts, style construction, viewport persistence, map controls, and base map interactions. Keep forecast domain logic out of this layer.

- `core/*`: dependency-light primitives such as config, abort/error helpers, math, geo, URL joining, keyboard helpers, and shared type helpers. Keep this precise; do not turn it into a utility bucket.

- `radio/*`: audio playlist/player behavior used by map controls.

- `styles/*`: global CSS split by surface area. Import through `styles/index.css`.

- `assets/*`: static frontend assets.

- `test/*`: shared test setup and fixtures for manifests, map stubs, payloads, provider wrappers, IndexedDB, and abort signals.

## Coordination Pattern

Preferred orchestration shape:

1. `ForecastApp` loads the manifest index through `useForecastManifest` and owns top-level app status projection.
2. `ForecastShell` installs selection, time, and settings providers around map and panel UI.
3. `ForecastMap` owns MapLibre lifecycle through `map/useMap` and bridges
   `forecast/settings` to `forecast/render` and `forecast/sync`.
4. `forecast/sync/useForecastSync` resolves the current catalog/time selection into a forecast sync plan with ordered window plans plus timeline request callbacks,
   waits for a render host capability, exposes initial sync state, and publishes applied probe frames through a callback.
5. `forecast/sync/request/useRequestRunner` creates sync-session load jobs, applies loaded forecast windows through the render host, publishes the applied probe frame, commits successful jobs, and notifies the timeline.
6. `forecast/render/*` reconciles active renderer profiles and applies already-loaded forecast windows to MapLibre custom layers.

Guideline: keep durable domain state in the relevant provider module, use
`forecast/sync` for cross-domain coordination, plan resolution, frame
loading, and request/window orchestration. Keep `forecast/sync` internals
private, keep raster sampling and place-probe
orchestration inside `forecast/place-probes`, and keep renderer/runtime details
inside `forecast/render` and `map`.
