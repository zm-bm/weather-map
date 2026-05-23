# Weather Map Roadmap

Last updated: 2026-05-21

This roadmap tracks the next meaningful app and engineering directions for
Weather Map. It is intentionally concise: use it to decide what matters next,
then create a focused implementation plan when a task is ready to execute.

## Next Priorities

### 1. Review Scalar Palettes And Boundary Correctness

Confirm that every field-rendered layer has the right color stops, unit
behavior, legend ticks, display range, and boundary handling.

Include exact-boundary checks for values on and around color stops.

### 2. Add Selected Forecast Rendering Controls

Expose a small, useful set of runtime controls in the map options UI.

This should be a curated app control surface, not a debug panel. Good
candidates are controls that are safe to adjust live and easy to understand,
such as field opacity/intensity or particle density/speed.

### 3. Evaluate MapLibre-Level Options

Decide whether map-level options such as globe projection or drag rotation
belong in the app UI.

Treat this as app design plus renderer validation, not just adding toggles.

## Operational Follow-Ups

### ETL Health Notifications

Add low-noise notifications when ETL health is stale, failing, or otherwise
requires attention.

Start with failure and staleness notifications. Avoid success notifications
unless they are opt-in or otherwise low-noise.

## Ideas

- Evaluate delta or predictive field encoding only if real payload or cost data
  shows current compression and caching are not enough.
- Consider breaking global fields into gridded chunks if viewport-scoped fetches
  become more important than whole-frame simplicity.
- Add a Waves layer if a suitable NOAA wave source and artifact contract are
  identified.
