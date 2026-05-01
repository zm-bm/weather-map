# Frontend Source Map

This document defines preferred domain terms and module ownership boundaries for
`frontend/src`.

## Core Terms

- `forecast`: umbrella domain for manifest loading, timeline navigation, product selection, and map frame application.
- `cycle`: model run initialization timestamp (`YYYYMMDDHH`).
- `hourToken` or `leadHour`: forecast offset token from cycle (`000`, `003`, ...), used for manifest frame and payload keys.
- `validTimeMs`: minute-resolved selected forecast time in UTC epoch milliseconds; primary timeline state value.
- `frame window`: the lower/upper forecast-hour pair plus interpolation mix used to represent a continuous selected time.
- `frame`: concrete render target formed by `{ cycle, hourToken }`.
- `scalar`: gridded scalar fields such as temperature, humidity, pressure, and precipitation rate.
- `vector`: vector field (`u/v`) and particle visualization pipeline.
- `variable`: selected meteorological field; prefer this over generic `layer` in UI/domain code.
- `overlay`: map-rendered visual layer above the basemap.
- `sync`: process that turns current app state into applied MapLibre/runtime resources.
- `probe`: sampling a rendered forecast frame at a map coordinate for label/readout display.

## Top-Level Flow

`App.tsx` loads the latest manifest through `manifest/useManifest`, projects
startup state into `app-status`, then renders `components/ForecastShell`.

`ForecastShell` wires the main providers:

- `forecast-selection`: active scalar/vector variables and unit options.
- `forecast-time`: selected valid time and playback state.

`components/ForecastMap` owns the MapLibre host instance and calls
`forecast-sync/useForecastSync`, which coordinates startup, request building,
payload loading, and layer application.

## Module Ownership

- `app-status/*`: global blocking/toast status state, priority selection, and host rendering inputs. Use this for cross-cutting load/error states that should surface above the app.

- `components/*`: React composition and panel/control UI. Components should consume domain contexts and hooks rather than owning payload decoding, MapLibre setup, or artifact fetching directly.

- `forecast-selection/*`: active scalar/vector choice and per-variable unit option state derived from the loaded manifest. Keep product selection concerns here, separate from time selection.

- `forecast-time/*`: valid-time selection, playback state, cycle forecast-hour bounds, and formatting helpers. This layer should not know about scalar/vector payload decoding or MapLibre runtime details.

- `manifest/*`: fetch, parse, validate, and expose forecast manifests. This is the source of typed manifest contracts used by selection, frame loading, and UI metadata.

- `forecast-frame/*`: frame specs, frame windows, scalar/vector payload decoding, frame loading, and frame prefetching. This module translates manifest data plus the selected time into concrete frame data.

- `forecast-cache/*`: byte-limited memory and IndexedDB payload cache. Keep eviction, scope changes, and pending writes here so frame/layer code can treat cache reads and writes as an implementation detail.

- `forecast-sync/*`: orchestration layer for startup policy, sync request composition, abort/dedupe, frame loading, layer updates, probe-frame publication, and app-status projection. It should coordinate modules, not decode payload formats itself.

- `forecast-layers/*`: forecast renderer adapters, controllers, shaders, and renderer-specific options. This module should install MapLibre custom layers and apply already-loaded frame windows only; frame loading and probe behavior live elsewhere.

- `forecast-metadata/*`: static metadata helpers for forecast products when the manifest does not carry all UI metadata directly.

- `map/*`: MapLibre host platform, style construction, viewport persistence, map controls, and base map interactions. Keep forecast product logic out of this layer.

- `forecast-probe/*`: public probe facade, scalar point samplers, current applied scalar frame store, and probe-value formatting. `forecast-sync` publishes applied scalar frames, and map label components read sampled values through the public facade.

- `units/*`: unit conversion and formatting primitives shared by UI and probe display.

- `url/*`: URL joining and related URL utilities.

- `styles/*`: global CSS split by surface area. Import through `styles/index.css`.

- `test/*`: shared test setup and fixtures for manifests, map stubs, payloads, provider wrappers, IndexedDB, and abort signals.

## Coordination Pattern

Preferred orchestration shape:

1. `App` loads manifest and owns top-level app status projection for manifest startup.
2. `ForecastShell` installs selection and time providers around map and panel UI.
3. `ForecastMap` owns MapLibre lifecycle through `map/useMap`.
4. `forecast-sync/useForecastSync` turns provider state into frame/layer sync requests.
5. `forecast-sync/useSyncRunner` loads frames through `forecast-frame`, applies them through `forecast-layers`, then publishes the applied scalar frame through `forecast-probe`.
6. `forecast-layers/*` adapters/controllers apply scalar/vector renderer changes to the map host.

Guideline: keep durable domain state in the relevant provider module, use
`forecast-sync` for cross-domain coordination, keep frame loading inside
`forecast-frame`, keep probe sampling inside `forecast-probe`, and keep
renderer/runtime details inside `forecast-layers` and `map`.
