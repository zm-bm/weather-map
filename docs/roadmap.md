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

### 3. Evaluate Geo-Chunked Field Payloads

The app currently fetches global field payloads even when the map is zoomed
into a small region. Prototype numeric geo-chunks so regional views can load
only nearby data.

Tasks:

- choose a source-grid or geo-indexed chunk layout for one representative
  artifact
- add a small chunk index to the manifest or artifact metadata
- load only the chunks intersecting the current viewport
- prefer numeric field chunks over rendered XYZ image tiles; the frontend still
  needs real values for particles, probes, palettes, and transforms

Good enough when: one layer can load and render from geo-chunked numeric
payloads for a zoomed-in viewport.

### 4. Add Forecast Model Expansion Track

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
