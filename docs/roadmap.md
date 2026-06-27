# Weather Map Roadmap

Last updated: 2026-06-27

## Next Priorities

### 1. Add ETL Health Notifications

Send low-noise notifications when ETL is stale, failing, or stuck.

Tasks:

- start with stale published data, Batch worker failures, and publisher failures
- send one useful alert with dataset, cycle, run id, and a log/status link
- group or suppress repeats so one bad cycle does not spam
- write down the common alert meanings and first debug step

Good enough when: a real ingest/publish failure is visible without watching AWS
dashboards manually.

### 2. Evaluate Geo-Chunked Field Payloads

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

### 3. Add Backend-Backed Places Search

The current search box only searches places that are already present in the
basemap PMTiles source. That misses plenty of real places, especially smaller
towns and alternate names. Add a real places search path through the backend.

Tasks:

- choose the backend place source/index and the minimum result shape the UI
  needs: name, region/country, lon/lat, and rank/type
- add a small `/api` search endpoint with query text, result limits, and boring
  validation
- wire the search panel to the backend with debounce, loading, empty, and error
  states
- keep PMTiles place features for map labels/probes; search should not depend
  on what is visible in the current vector tiles

Good enough when: searching for a reasonable small city or town can find it
even if it is not in the local PMTiles place set, and selecting it recenters the
map cleanly.

### 4. Add Point Forecasts for Selected Locations

Clicking or selecting a location should feel like choosing a forecast point, not
just reading the current probe value. Add a selected-location flow with a map pin
and a compact hourly/daily forecast view.

Tasks:

- add selected point state that works for both map clicks and place-search
  results
- draw a simple pin/marker at the selected point and keep it stable while the
  map moves
- build a point forecast panel with the location name or coordinates, current
  value, and an hourly/daily forecast summary
- sample or load the forecast time series for the selected point without forcing
  unrelated layers to render
- handle loading, missing data, and layer/model changes without leaving stale
  values on screen

Good enough when: picking a location shows a pinned point and a useful short
forecast timeline instead of only the current map value.

### 5. Add Forecast Model Expansion Track

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
