# Weather Map Roadmap

Last updated: 2026-06-26

## Next Priorities

### 1. Pre-warm Cache After Model Runs

After a model run publishes, warm the public artifacts the app is most likely
to ask for first. Keep it cheap and boring.

Tasks:

- pick the small set of manifest, PMTiles, and first-frame artifact URLs worth
  warming
- trigger warming from publish or a tiny follow-up job
- make it fine to rerun and fine to skip when artifacts are missing
- log enough timing/status info to tell whether it helped

Good enough when: a newly published cycle opens quickly on first load without
adding another service to babysit.

### 2. Add ETL Health Notifications

Send low-noise notifications when ETL is stale, failing, or stuck.

Tasks:

- start with stale published data, Batch worker failures, and publisher failures
- send one useful alert with dataset, cycle, run id, and a log/status link
- group or suppress repeats so one bad cycle does not spam
- write down the common alert meanings and first debug step

Good enough when: a real ingest/publish failure is visible without watching AWS
dashboards manually.

### 3. Fix Particles for Rotated Viewports

Wind particles currently assume an unrotated map viewport, so drag rotation is
disabled. Make particle positioning handle map pitch/rotation, then turn
rotation back on.

Tasks:

- add pitch/rotation to the particle viewport state
- pass the new viewport values through particle uniforms
- update `VECTOR_PARTICLE_VERTEX_SHADER_SOURCE` / particle vertex shader logic
  so particle positions match the rotated viewport
- re-enable `dragRotation` in the MapLibre map config
- verify rotated desktop and mobile views with particles enabled

Good enough when: wind particles stay aligned while rotating the map.

### 4. Add Optional Globe View

Mercator is fine, but a globe mode would be a nice way to inspect broad weather
patterns.

Tasks:

- add a small UI option for map projection
- toggle the MapLibre style/projection between Mercator and globe
- update the wind particle vertex path for globe projection
- verify raster, overlays, contours, particles, labels, and probe behavior in
  both projections

Good enough when: globe mode is usable without breaking the default Mercator
forecast workflow.

### 5. Check Field Payload Strategy

Only change the artifact format if real payload or cost data says the current
compression and caching path is not enough.

Tasks:

- measure payload sizes, cache hit behavior, and first-load bottlenecks for
  representative layers
- try simple compression/caching improvements before changing artifact layout
- prototype chunking or predictive encoding only against measured pain points
- keep the whole-frame path unless the numbers make the extra complexity worth
  it

Good enough when: there is clear evidence for keeping the current payload path
or a concrete reason to change it.

### 6. Add Forecast Model Expansion Track

Plan support for additional forecast models such as HRRR and ECMWF. Treat this
as source/model expansion first, not just adding catalog rows.

Initial models:

- HRRR
- ECMWF

Tasks:

- define model ids, run availability, and forecast-hour coverage
- map fields into the existing artifact shapes
- list which current layers each model can support
- choose whether model selection is global, per-layer, or hidden until support
  is broad enough

Good enough when: adding another model clearly improves the app instead of just
adding maintenance load.
