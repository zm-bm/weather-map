# Frontend Source Map

Quick map for `frontend/src`. ETL and product-config terms live in
[`../../config/README.md`](../../config/README.md).

## App Flow

1. `app/ForecastApp.tsx` loads `manifests/index.json` and chooses the active
   dataset/layer state.
2. `forecast/ui/ForecastShell` installs selection, time, and settings providers
   around the map viewport and HUD.
3. `forecast/sync/useForecastSync` turns current app state into load requests,
   loaded forecast windows, render updates, and probe frames.
4. `forecast/render/*` applies already-loaded windows to MapLibre custom layers.

## Modules

- `app/*`: top-level route/app wiring and startup status.
- `forecast/ui/*`: React shell, panels, controls, and forecast HUD.
- `forecast/catalog/*`: parsed frontend catalog, user-facing layer entries,
  layer groups, source recipes, and source helpers.
- `forecast/selection/*`: selected raster layer and particle layer.
- `forecast/time/*`: valid-time selection, playback state, time bounds, and
  formatting.
- `forecast/settings/*`: map presentation settings, units, and render feature
  toggles.
- `forecast/manifest/*`: manifest-index fetch/parse state, active dataset
  helpers, and dataset/layer availability.
- `forecast/artifacts/*`: artifact payload fetch/cache/decode helpers.
- `forecast/frames/*`: shared loaded-frame/window types used by sync, render,
  and place probes.
- `forecast/sync/*`: cross-domain loading and request orchestration. Internals
  are grouped as `plan`, `load`, and `request`.
- `forecast/render/*`: renderer runtime, shader paths, renderer profiles, and
  MapLibre custom-layer reconciliation.
- `forecast/place-probes/*`: place selection, raster sampling, labels, and map
  source/layer updates for probes.
- `forecast/display/*`: display profiles, units, legend layout, and palettes.
- `map/*`: MapLibre host setup, style construction, basemap behavior, viewport
  persistence, and base map controls.
- `core/*`: small shared primitives such as config, abort/error helpers, math,
  geo helpers, URL joining, keyboard helpers, and shared types.
- `styles/*`: global CSS split by surface area.
- `assets/*`: static frontend assets.
- `test/*`: shared test setup, fixtures, map stubs, payload helpers, provider
  wrappers, IndexedDB helpers, and abort-signal helpers.

## Rules of Thumb

- Providers own durable app state.
- `forecast/sync` coordinates loading, but render and probe code interpret the
  loaded frames.
- Renderer and MapLibre details stay in `forecast/render` and `map`.
- UI components consume domain hooks; leave payload fetch/decode work in the
  domain modules.
