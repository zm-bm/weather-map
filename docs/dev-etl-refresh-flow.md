# Development Scalar Weather Flow

This documents how scalar weather payloads are produced by `etl` and loaded into `tileserver` in local development.

## One-command dev refresh

Run:

```bash
scripts/dev-refresh.sh <cycle>
```

Example cycle format: `YYYYMMDDHH` (for example `2026021606`).

That script runs three steps in order:

1. `python -m gfs_pipeline.cli dev-run --cycle <cycle>`
2. `python -m gfs_pipeline.cli publish --cycle <cycle>`
3. `scripts/poll-tiles.sh` with:
   - `ARTIFACT_SOURCE=<repo>/etl/out`
   - `TILESERVER_DIR=<repo>/tileserver`
   - `RESTART_ENABLED=false`

Source: `scripts/dev-refresh.sh`.

## ETL processing (dev-run)

`dev-run` reads `etl/pipeline_config.json` for:

- forecast hours (currently `000..018` every 3h)
- weather layers (`workload.layers`)
- wind artifacts (`wind_artifacts`)
- NOMADS download config

For each forecast hour:

1. Build NOMADS URL for that cycle/hour.
2. Download GRIB to local cache:
   - `etl/data/grib_cache/<cycle>/gfs.t<hour>z.pgrb2.0p25.f<fhour>`
3. Queue one `process-hour` task that processes all configured weather layers and wind artifacts for that hour.

Workers run in a multiprocessing pool (`--procs`, default `4`).

Sources: `etl/gfs_pipeline/cli.py`, `etl/gfs_pipeline/nomads.py`, `etl/pipeline_config.json`.

## Per-hour processing pipeline

Each `process-hour` run handles one `(cycle, fhour)` and then loops configured weather layers and wind layers.

For each weather layer it does:

1. Read GRIB from `source_uri`.
2. Resolve the source GRIB band using `layer.grib_match`.
3. Extract source values and apply configured scalar source transform (`identity` or `kelvin_to_celsius`).
4. Encode payload as `scalar-i16-linear-v1` and write:
   - `etl/out/weather/<cycle>/<fhour>/<layer>.scalar.i16.bin`
5. Write success marker:
   - `etl/out/status/<cycle>/<layer>/<fhour>._SUCCESS.json`

For each wind layer it writes vector payloads under:

- `etl/out/weather/<cycle>/<fhour>/<layer>.vector.i8.bin`

Wind decode/grid metadata is written into success markers and then promoted into the cycle manifest during publish.

Sources: `etl/gfs_pipeline/worker.py`, `etl/gfs_pipeline/scalar_product.py`, `etl/gfs_pipeline/wind_product.py`.

## Publish step

`publish` validates readiness before writing manifests:

1. Compute expected success markers for all configured weather layers, wind layers, and forecast hours.
2. If anything is missing, exit not-ready.
3. If complete, write:
   - `etl/out/manifests/<cycle>.json`
   - `etl/out/manifests/latest.json`
   - `etl/out/status/<cycle>/_PUBLISHED.json`

`latest.json` is the single canonical pointer used by the frontend.

Source: `etl/gfs_pipeline/publish.py`.

## Sync into tileserver (dev)

`scripts/poll-tiles.sh` compares upstream `manifests/latest.json` with local
`tileserver/public/manifests/latest.json`.

When cycle changes, it copies:

- manifests to `tileserver/public/manifests/`:
  - `<cycle>.json`, `latest.json`
- matching cycle weather scalar/vector payloads to `tileserver/public/weather/<cycle>/`

By default it also prunes old cycle weather artifacts and removes legacy manifest names.

Source: `scripts/poll-tiles.sh`.

## Runtime serving path

In `compose.dev.yml`:

- Martin mounts `./tileserver` as `/data` and serves basemap/static tilesets.
- nginx mounts the same `/data` and serves:
  - `/manifests/*` from `/data/public/manifests/`
  - `/weather/*` from `/data/public/weather/`
- nginx proxies tile/font/sprite requests to Martin (`http://martin:3001`).

Sources: `compose.dev.yml`, `tileserver/martin.yaml`, `deploy/nginx.dev.conf`.

## Frontend loading behavior

Frontend flow:

1. Fetch `GET /manifests/latest.json`
2. Fetch `GET /manifests/<cycle>.json`
3. Resolve weather payload from `frames[hourToken][variable].path`
4. Fetch payload from `/weather/<cycle>/<hour>/<variable>.*.bin` (`scalar.i16.bin` for weather, `vector.i8.bin` for wind)
5. Decode and render using manifest-provided encoding/grid metadata

Sources: `frontend/src/api/manifests.ts`, `frontend/src/map/weather/payload.ts`, `frontend/src/map/wind/payload.ts`.

## Practical note

`scripts/dev-refresh.sh` sets `RESTART_ENABLED=false`, so it does not restart services automatically after sync. If runtime does not pick up new files in your local run, restart the compose stack.
