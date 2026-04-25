# weather-map

## Overview

Weather forecast map app with a local ETL pipeline, a Vite frontend, and a
small nginx dev server that serves generated artifacts from `artifacts/`.

## Prerequisites

- Docker with `docker compose`
- `python3` with `venv` support for local ETL runs
- GDAL CLI tools on your host for local ETL runs (`gdalinfo`, `gdal_translate`, `gdalwarp`)
- Optional: `pmtiles` CLI if you want to extract a smaller local basemap archive

## Development

Start the dev stack with:

```bash
docker compose up --build
```

That runs:

- `frontend` on `http://localhost:5173`
- `nginx` artifact serving on `http://localhost:3000`

Local forecast artifacts are written directly into `artifacts/` by the ETL.
Run `run-cycle.sh` with a forecast cycle to refresh the local forecast
artifacts served by the dev stack.

```bash
etl/scripts/local/run-cycle.sh <cycle>
```

## Configuration

Local config lives in a repo-root `.env`. The only current optional dev setting
is `VITE_BASEMAP_FILENAME`.

### Optional PMTiles Basemap

The basemap is optional. If `VITE_BASEMAP_FILENAME` is unset, the frontend runs
without it.

1. Download a PMTiles build from `https://maps.protomaps.com/builds/`
2. Run `pmtiles extract --maxzoom=6 <input>.pmtiles artifacts/pmtiles/20260424.z6.pmtiles`
3. Set `VITE_BASEMAP_FILENAME=20260424.z6.pmtiles` in your repo-local `.env`
4. Run `docker compose up --build`

## Testing

Run frontend tests from `frontend/`:

```bash
npm run test:run
```

Run frontend typecheck/build verification from `frontend/`:

```bash
npm run build
```

Run ETL tests from `etl/`:

```bash
python -m unittest discover -s gfs_pipeline/tests -p 'test_*.py'
```

## Docs

- Development ETL artifact flow: [docs/dev-etl-refresh-flow.md](docs/dev-etl-refresh-flow.md)
- Production ETL refresh flow: [docs/prod-etl-refresh-flow.md](docs/prod-etl-refresh-flow.md)
