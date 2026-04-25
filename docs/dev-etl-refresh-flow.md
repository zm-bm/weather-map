# Development Forecast Artifact Flow

This documents how forecast manifests and binary payloads are produced by `etl` and served in local development.

The local artifact root is `artifacts/`, which mirrors the production bucket layout.

## One-command dev refresh

Run:

```bash
etl/scripts/local/run-cycle.sh <cycle>
```

Example cycle format: `YYYYMMDDHH` (for example `2026021606`).

`run-cycle.sh` refreshes the local forecast artifacts for that cycle. Internally
it makes sure the local ETL environment is ready before running:

1. `etl/.venv/bin/python -m gfs_pipeline.cli run-cycle --cycle <cycle>`

Source: `etl/scripts/local/run-cycle.sh`.

## ETL processing (`run-cycle`)

`run-cycle` reads `etl/gfs.etl_config.json` for:

- forecast hours (currently `000..036` hourly)
- scalar variables (`workload.variables`)
- vector variables (`vector_variables`)
- NOMADS download config

For each forecast hour:

1. Build NOMADS URL for that cycle/hour.
2. Download GRIB to local cache:
   - `etl/cache/grib/<cycle>/gfs.t<hour>z.pgrb2.0p25.f<fhour>`
3. Queue one `run-hour` task that processes all configured scalar and vector variables for that hour.

Workers run in a multiprocessing pool (`--procs`, default `4`).

Sources: `etl/gfs_pipeline/cli.py`, `etl/gfs_pipeline/nomads.py`, `etl/gfs.etl_config.json`.

## Per-hour processing pipeline

Each `run-hour` invocation handles one `(cycle, fhour)` and then loops configured scalar and vector variables.

For each scalar variable it does:

1. Read GRIB from `source_uri`.
2. Resolve the source GRIB band using `layer.grib_match`.
3. Extract source values and apply configured scalar source transform (`identity` or `kelvin_to_celsius`).
4. Encode payload as `scalar-i16-linear-v1` and write:
   - `artifacts/fields/<cycle>/<fhour>/<layer>.scalar.i16.bin`
5. Write success marker:
   - `artifacts/status/<cycle>/<layer>/<fhour>._SUCCESS.json`

For each vector variable it writes vector payloads under:

- `artifacts/fields/<cycle>/<fhour>/<layer>.vector.i8.bin`

Wind decode/grid metadata is written into success markers and then promoted into the cycle manifest during publish.

Sources: `etl/gfs_pipeline/worker.py`, `etl/gfs_pipeline/scalar_product.py`, `etl/gfs_pipeline/wind_product.py`.

## Publish step

`run-hour` publishes by default after processing one hour, and `run-cycle`
publishes once at the end of the cycle. Both use the same readiness checks in
`publish.py` before writing manifests:

1. Compute expected success markers for all configured scalar variables, vector variables, and forecast hours.
2. If anything is missing, exit not-ready.
3. If complete, write:
   - `artifacts/manifests/<cycle>.json`
   - `artifacts/manifests/latest.json`
   - `artifacts/status/<cycle>/_PUBLISHED.json`

`latest.json` is the single canonical latest-manifest alias used by the frontend.

Sources: `etl/gfs_pipeline/cli.py`, `etl/gfs_pipeline/publish.py`.

## Runtime serving path

In `compose.yml`:

- nginx mounts `./artifacts` as `/artifacts` and serves:
  - `/manifests/*` from `/artifacts/manifests/`
  - `/fields/*` from `/artifacts/fields/`
  - `/radio/*` from `/artifacts/radio/`
  - `/pmtiles/*` from `/artifacts/pmtiles/`
- the frontend dev server serves app/static assets directly from `frontend/public`, including:
  - `/glyphs/{fontstack}/{range}.pbf`
- `compose.yml` bind-mounts `frontend/src` into the frontend container for live
  source edits
- `frontend/public` stays inside the container image, so changes there require a
  frontend rebuild instead of live-updating through a bind mount
- `compose.yml` forwards `VITE_BASEMAP_FILENAME` from the repo-root `.env` into
  the frontend container
- the frontend only adds the basemap when `VITE_BASEMAP_FILENAME` is provided

The PMTiles basemap is optional in local development. If you want it enabled:

1. Download a PMTiles build from `https://maps.protomaps.com/builds/`
2. Put it at `artifacts/pmtiles/20260424.z6.pmtiles`
3. Set `VITE_BASEMAP_FILENAME` in a repo-local `.env` file using `.env.example` as
   the template

Sources: `compose.yml`, `nginx.conf`, `frontend/scripts/build-glyphs.mjs`.

## Frontend loading behavior

Frontend flow:

1. Fetch `GET /manifests/latest.json`
2. Fetch `GET /manifests/<cycle>.json`
3. Resolve weather payload from `frames[hourToken][variable].path`
4. Fetch payload from `/fields/<cycle>/<hour>/<variable>.*.bin` (`scalar.i16.bin` for weather, `vector.i8.bin` for wind)
5. Decode and render using manifest-provided encoding/grid metadata

Sources: `frontend/src/manifest/fetch.ts`, `frontend/src/forecast-frame/loader.ts`.
