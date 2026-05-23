# Frontend Module Review Plan

Last updated: 2026-05-22

This plan describes how to review frontend module internals now that the main
module boundaries are cleaner. The goal is not broad aesthetic cleanup. The
goal is to find places where runtime behavior, state ownership, lifecycle
cleanup, or public APIs are still harder to reason about than they need to be.

Use this as a repeatable audit checklist when taking on focused cleanup commits.

## Review Order

Review modules by runtime responsibility and risk, not alphabetically.

### 1. `forecast-sync`

Start with sync because it coordinates request identity, loading, stale request
handling, startup status, prefetch, render application, and probe-frame
publication.

Check for:

- request lifecycle paths that are hard to follow
- stale, aborted, blocked, and failed request behavior
- unnecessary React state in hot paths
- callback refs or effects that can accidentally restart work
- tests that assert implementation details instead of observable sync behavior

### 2. `forecast-render`

Review the imperative renderer runtime after sync. This module should install
renderers, configure installed renderers, and apply render data.

Check for:

- controller APIs that are larger than their actual runtime contract
- settings that repaint when they should reload, or reload when they should
  repaint
- mutable runtime state that crosses renderer/controller boundaries unclearly
- public exports that expose implementation details

### 3. `forecast-place-probes`

Review place probes as a feature module. It owns MapLibre probe sources/layers,
hover behavior, visible place selection, field sampling, label generation, and
frame-channel subscription.

Check for:

- session lifecycle clarity
- listener, RAF, and MapLibre event cleanup
- internal helper names inherited from old locations
- unnecessary public exports
- test coverage for frame updates, hover cleanup, and style-removal tolerance

### 4. Forecast Data And Sync

Review `forecast-sync` target resolution and `forecast-data` after the runtime
owners are clear.

Check for:

- target resolver, source descriptor, data request, and loaded data naming
- per-slice cache vs reusable-window memory ownership
- field, cloud, precip-type, pressure, and wind-vector data-load responsibilities
- duplicated branching between sync target adaptation and data loading
- tests that cover data-request outcomes rather than private helper sequencing

Current guidance:

- Keep catalog/time target resolution inside `forecast-sync`; data loaders
  should consume data-ready descriptors, not catalog layer objects.
- Keep `ForecastDataTarget` and source descriptor contracts owned by
  `forecast-data`, because they are the session input shape.
- Keep `forecast-data/loaders` private and slice-focused: each loader owns
  capability checks, slice cache keys, time-slice loading, semantic
  materialization, failure policy, and optional slice-level probe projection.
- Keep `forecast-data` as orchestration behind a per-runtime data session:
  data options, request keys, request creation, interpolation windows, prefetch,
  reusable-window memory, and loaded data-window assembly. Its public index
  should expose the session factory and semantic data contracts only; request,
  memory, loader, and prefetch internals should stay private.
- Keep sync responsible for app/user options that decide whether optional
  data families are requested; loaders should execute explicit options, not
  infer UI settings.
- Keep render-specific packing and GPU texture shapes in `forecast-render`.
  Forecast data modules should expose meteorological data windows and derived
  data semantics only.

### 5. `forecast-time`

Review time as the owner of timeline state and playback callbacks.

Check for:

- whether timeline callbacks are clearly separated from data loading
- playback state transitions and boundary behavior
- names that distinguish selected time, target time, valid time, and loaded data
  time
- unnecessary coupling to sync or render modules

### 6. `forecast-settings`

Review settings as the owner of user-facing map presentation settings.

Check for:

- settings shape and action names
- grouped defaults for field, particles, and pressure contours
- derived render profile/runtime settings
- whether new user controls can be added without touching renderer internals

### 7. `forecast-catalog` And `forecast-manifest`

Review catalog and manifest after the runtime and display contracts are stable.

Check for:

- catalog ownership of user-facing layers, palettes, source recipes, and display
  metadata
- manifest ownership of artifact availability and payload references
- validation paths for raw JSON
- accidental cross-imports between manifest helpers and catalog ids

### 8. Pure Display Modules

Review foundational display modules after catalog dependencies are clear.

Relevant modules include:

- `units`
- `forecast-legend`
- shared palette/display contracts, if any remain

Check for:

- no React, map, sync, render, catalog-internal, or app-composition imports
- small public APIs
- tests based on behavior and rendered labels, not catalog fixture shape

### 9. `map`

Review map as a generic MapLibre platform module.

Check for:

- no forecast feature imports
- basemap constants exposed through the smallest useful contract
- MapLibre lifecycle ownership
- event and cleanup behavior

### 10. `components`

Review components last. By this point, components should mostly compose hooks,
contexts, presentational UI, and thin adapters around feature modules.

Check for:

- heavy behavior that should live in a feature/domain module
- large objects passed through React state or props on playback paths
- duplicated formatter or selection wiring
- tests that can be moved closer to the behavior owner

## Per-Module Checklist

For each module, ask the same questions:

1. Can the module's job be summarized in one sentence without adding "and also"?
2. Is mutable state owned locally and exposed through explicit boundaries?
3. Are subscriptions, effects, request aborts, RAFs, event listeners, and
   cleanup paths obvious?
4. Does React state avoid large payloads and high-frequency update paths?
5. Are names precise from the module's current responsibility, not inherited
   from old file locations?
6. Does `index.ts` export only the intended public API?
7. Do small files reduce cognitive load, or do they only add indirection?
8. Do tests cover meaningful behavior and edge cases?
9. Does the module depend only on lower-level contracts it should know about?
10. Can a future feature be added by changing the owning module instead of
    threading state through unrelated layers?

## Commit Strategy

Keep review commits small and grouped by runtime responsibility:

1. `forecast-sync` internals
2. `forecast-render` internals
3. `forecast-place-probes` internals
4. data, time, and settings cleanup
5. map and component thinness pass

Each pass should include focused tests for the touched modules, then full
frontend verification:

```sh
npm run test:run
npm run lint
npm run build
git diff --check
```

## Guardrails

- Prefer deletion and clearer ownership over new abstraction.
- Avoid churn that only renames already-clear code.
- Keep hot-path payloads out of React state unless the UI truly needs to render
  them.
- Let public APIs describe concepts at the module boundary; keep implementation
  names private.
- Update import-boundary tests when a cleanup creates a clearer rule.
