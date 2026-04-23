# Frontend Domain Naming

This document defines the preferred domain terms for frontend map/forecast code.

## Core Terms

- `forecast`: umbrella domain for timeline navigation and cross-domain frame application.
- `cycle`: model run initialization timestamp (`YYYYMMDDHH`).
- `hourToken` (or `leadHour`): forecast offset token from cycle (`000`, `003`, ...), used for frame/payload keys.
- `hourIndex`: index into `manifest.forecast_hours`; primary timeline state value in UI/transport/coordinator APIs.
- `frame`: concrete render target formed by `{ cycle, hourToken }`.
- `scalar`: gridded scalar fields (temperature, humidity, pressure, etc.) rendered from numeric payloads.
- `vector`: vector field (`u/v`) and particle visualization pipeline.
- `variable`: selected meteorological field (prefer over generic `layer` in domain logic).
- `overlay`: map-rendered visual layers above basemap.
- `sync`: process that applies a requested frame to map/runtime resources.
- `forecast-time`: forecast hour selection, playback, and frame-sync state.
- `forecast-sync`: orchestration layer that turns selected forecast time/variables into applied map frames.

## Ownership Boundaries

- `forecast-time/state` + `forecast-time/ForecastTimeProvider`:
  - forecast-time intent/state only.
  - no map rendering logic, no product fetch/upload logic.

- `forecast-sync/*`:
  - startup sync policy, request composition, dedupe/abort, and app-status projection.
  - no scalar/vector payload decoding or runtime uploads.

- `forecast-layers/scalar/*`:
  - scalar payload fetch/decode, scalar runtime uploads, probe ownership, and scalar display metadata.

- `forecast-layers/vector/*`:
  - vector payload fetch/decode and vector layer runtime updates.

- `forecast-frame/*`:
  - frame spec/loading shared by forecast renderers.

- `map/*`:
  - MapLibre host platform: style/runtime scaffolding, viewport/config, and host contracts.

## Coordinator Pattern

Preferred orchestration shape:

1. `forecast-time/ForecastTimeProvider` + `forecast-time/useForecastTimeContext`
2. `forecast-sync/useForecastSync` as the primary `ForecastMap` coordinator
3. `forecast-sync/useStartupState`, `useSyncRequest`, `useSyncRunner`, `useStartupAppStatus` as the internal orchestration pieces
4. `forecast-layers/*` renderers and frame adapters/controllers

Guideline: keep sync orchestration in `forecast-sync`, wired into `ForecastMap` via `useForecastSync`, while the MapLibre host lives in `map/*` and forecast renderers live in `forecast-layers/*`.
