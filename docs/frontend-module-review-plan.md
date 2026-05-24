# Frontend Module Review Plan

Last updated: 2026-05-24

This plan describes how to continue reviewing frontend module internals after
the major forecast runtime and source-layout refactors. The current structure is
much cleaner: app composition lives under `app/`, forecast ownership lives under
`forecast/`, generic MapLibre platform code lives under `map/`, and
dependency-light primitives live under `core/`.

The next review pass should not repeat broad boundary work that is already
settled. Use this plan to find the remaining places where state ownership,
lifecycle cleanup, naming, or public APIs are still harder to reason about than
they need to be.

## Current Baseline

These areas have already had focused cleanup passes and should be treated as
mostly stable unless a concrete issue appears:

- `forecast/sync`: runtime coordinator with internal target resolution,
  request tracking, initial sync state, prefetch, render application, and
  probe-frame publication.
- `forecast/render`: imperative renderer runtime with private adapters,
  registry/reconciliation, runtime settings application, and render-data apply.
- `forecast/place-probes`: React-free feature session for MapLibre probe
  sources/layers, hover, visible place selection, field sampling, labels, and
  frame-channel updates.
- `forecast/data`: semantic data contracts plus a per-runtime data session;
  private loaders/materialization live under `forecast/data/loaders`.
- `core/math` and `core/geo`: pure numeric and coordinate helpers.
- `forecast/ui`: moved under the forecast tree, with large behavior pushed into
  domain/runtime modules where practical.

Treat these as baselines. Review them for regressions or local simplification,
not for another module-boundary redesign by default.

## Next Review Order

Review modules by ownership risk and remaining ambiguity, not alphabetically.

### 1. `forecast/ui` And `app`

Start with the React composition layer after the source reorganization.
`ForecastMap`, `ForecastShell`, `ForecastApp`, and `AppStatusHost` are now the
main places where domain providers, map lifecycle, sync, render, controls, and
status projection meet.

Check for:

- `ForecastMap` doing bridge work that could move into a small local adapter or
  hook
- app-status projection staying in `app`, not forecast domain modules
- large payloads or high-frequency frame data entering React state or props
- prop-forwarding tests that duplicate behavior covered at a better boundary
- imports that bypass public module indexes after the directory move

Current guidance:

- Keep `ForecastMap` as the bridge between map, settings, render, sync, and
  place probes, but do not let it become a data-loading or renderer-runtime
  owner.
- Keep `ForecastShell` focused on provider composition and layout-level wiring.
- Keep route startup status in `ForecastApp`; forecast domain modules expose
  state, not app-status UI payloads.

### 2. `forecast/time` And `forecast/selection`

Review these providers next because they are foundational app state and they
feed sync, panels, controls, and formatter choices.

Check for:

- clear separation between selected time, target playback time, valid time, and
  loaded data time
- playback transition behavior at range boundaries
- context value size and action names
- selection defaults, unavailable-layer handling, and unit option state
- duplicated selection/time derivation in UI tests or sync tests

Current guidance:

- `forecast/time` owns timeline/playback state and sync callbacks, not data
  loading.
- `forecast/selection` owns selected layer, selected particle layer, and unit
  option state, not render settings or artifact availability resolution.
- Prefer small pure state helpers when provider tests need to cover transitions.

### 3. `map`

Review `map` as a generic MapLibre platform module. The map layer should be
usable without knowing that forecast rendering or place probes exist.

Check for:

- forecast imports creeping back into map platform code
- basemap constants and style helpers being exposed through the smallest useful
  contract
- MapLibre lifecycle, attribution, theme, viewport persistence, and cleanup
  behavior
- duplicated test doubles for map/style/layer operations

Current guidance:

- Keep forecast feature source/layer ownership in `forecast/render` or
  `forecast/place-probes`, not `map`.
- Keep `map/basemap` as the public basemap contract when forecast modules need
  stable basemap ids.
- Keep viewport persistence and MapLibre setup generic.

### 4. Catalog, Manifest, Artifacts, And Cache

Review the metadata and payload foundation after UI/map composition. These
modules are lower-level than sync/render, but they still define many naming and
availability contracts.

Relevant modules:

- `forecast/catalog`
- `forecast/manifest`
- `forecast/artifacts`
- `forecast/cache`

Check for:

- catalog ownership of user-facing layer definitions, particle layers, palettes,
  display ranges, and source recipes
- manifest ownership of remote metadata, model/run availability, artifact refs,
  and hour-token normalization
- artifact loader capability methods staying clear and data-domain agnostic
- cache scope, byte limits, pending writes, and IndexedDB error behavior
- tests that verify behavior instead of duplicating JSON fixture structure

Current guidance:

- Keep catalog and manifest separate: catalog describes frontend layer choices;
  manifest describes what the backend produced.
- Keep artifact decoding in `forecast/artifacts`; semantic slice
  materialization belongs to `forecast/data/loaders`.
- Keep cache modules generic enough that artifact users do not need to know
  whether bytes came from memory, IndexedDB, or the network.

### 5. `forecast/data`

Revisit data only after the foundation modules above. The current boundary is
right: `forecast/data` owns the `ForecastDataSession` facade and loaded-data
contracts, while loaders are private implementation details.

Check for:

- session methods staying cohesive: load jobs, prefetch, commit, and reset
- private request/load/prefetch/interpolation-window files that still have
  public-looking names or exports
- loader duplication that can be reduced without reintroducing renderer or
  catalog coupling
- request-key and reusable-window behavior covered through meaningful tests
- public index exports limited to session creation, options, target, and loaded
  semantic data contracts

Current guidance:

- Do not split `createLoadJob` and `prefetch` into separate public modules
  unless another production consumer appears.
- Keep `ForecastDataTarget` owned by `forecast/data`, but keep target resolution
  inside `forecast/sync`.
- Keep `forecast/data/loaders` private and slice-focused.

### 6. `forecast/sync`

Review sync opportunistically when data/time/render behavior changes. It is
still the highest-risk runtime coordinator, but its current public shape is
good.

Check for:

- request dedupe, stale detection, abort handling, and unmount cleanup
- callback refs that prevent identity churn from restarting work
- disabled and retry behavior
- probe-frame publication staying imperative and outside React state
- tests focused on observable lifecycle behavior, not private sequencing

Current guidance:

- Keep `useForecastSync` as the public runtime hook.
- Keep sync responsible for runtime coordination and target resolution, not
  artifact decoding, data memory, renderer internals, or app-status projection.

### 7. `forecast/render`

Review render internals only for local clarity or new renderer work. The module
should remain an imperative renderer runtime.

Check for:

- controller contracts that grow beyond install/configure/apply/remove needs
- renderer engines that mix GPU setup with semantic data decisions
- runtime settings that repaint when they should reload, or reload when they
  should repaint
- accidental public exports from renderer subdirectories

Current guidance:

- Renderers consume `LoadedForecastData` through `forecast/data`; they do not
  load artifacts or own user-facing settings state.
- Keep shader, LUT, texture, buffer, and MapLibre custom-layer details here.

### 8. `forecast/place-probes`

Review place probes when map interaction, probe labels, or frame-channel
behavior changes.

Check for:

- session lifecycle clarity and cleanup
- listener, RAF, hover, feature-state, and style-removal tolerance
- field sampling remaining private to place probes until another real consumer
  appears
- frame channel updates staying out of React state and props

Current guidance:

- Keep `ForecastPlaceProbes` in `forecast/ui` as a thin bridge.
- Keep heavy probe behavior in the React-free `forecast/place-probes` feature.

### 9. Settings And Pure Display Modules

Review settings and display primitives after user-facing control additions.

Relevant modules:

- `forecast/settings`
- `forecast/units`
- `forecast/legend`
- `forecast/palette`

Check for:

- settings grouped by user-facing feature, not renderer internals
- defaults and comments living with the settings contract
- display modules staying pure and dependency-light
- legend/unit/palette tests based on output behavior, not catalog fixture shape

Current guidance:

- `forecast/settings` owns map presentation settings and derived render/data
  options.
- `forecast/units`, `forecast/legend`, and `forecast/palette` are foundational
  display contracts and should not import React, map, sync, render internals, or
  app composition.

### 10. `core`, `radio`, `styles`, And `test`

Review these last unless they become active work areas.

Check for:

- `core` remaining precise, not a generic utility bucket
- `core/math` dependency-free and `core/geo` depending only on `core/math`
- `radio` staying isolated from forecast domain state
- stylesheet ownership staying clear after the app restructure
- shared test fixtures being used by multiple files and not hiding assertions

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

Keep review commits small and grouped by current ownership:

1. app and forecast UI composition
2. time and selection state
3. map platform cleanup
4. catalog, manifest, artifacts, and cache foundation cleanup
5. targeted data, sync, render, or place-probe follow-ups only when a concrete
   issue appears
6. settings, display primitives, core, styles, and test fixture cleanup

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
- Do not promote private code to a top-level module until at least two
  production owners need it.
