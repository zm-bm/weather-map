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
- `timeline`: timeline control state machine (play/pause/next/prev/requested/applied).

## Ownership Boundaries

- `state/timeline` + `TimelineProvider`:
  - timeline intent/state only.
  - no map rendering logic, no product fetch/upload logic.

- `map/scalar/*`:
  - scalar payload fetch/decode, scalar runtime uploads, scalar-specific sync.

- `map/vector/*`:
  - vector payload fetch/decode and vector layer runtime updates.

- `map/*`:
  - generic MapLibre style/runtime scaffolding.

## Coordinator Pattern

Preferred orchestration shape:

1. `TimelineProvider` + `useTimelineContext`
2. `useStartupSyncState` (startup phase + retry/error policy)
3. `useFrameSyncRunner` (dedupe/abort/effectful frame execution)
4. `useFrameSyncRequest` (context-derived frame sync request composition)
5. `map/scalar/*` + `map/vector/*` runtime/frame adapters/controllers

Guideline: keep startup policy and frame execution as separate hooks, wired in `ForecastMap`, while scalar and vector runtime concerns remain in separate domain modules.
