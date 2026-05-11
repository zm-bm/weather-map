# weather-map

## Overview

Weather forecast map app with a Vite frontend, a local forecast ETL, and an
nginx artifact server for development.

## Layout

- `frontend/` is the React/Vite MapLibre app.
- `etl/` owns forecast artifact generation and local ETL helpers.
- `infra/` owns project infrastructure, production ETL config, and production
  release/operator scripts.
- `artifacts/` is the local artifact root served by nginx in development.

## Prerequisites

- Docker with `docker compose`
- `python3` with `venv` support for ETL tests and development tooling
- Optional: `pmtiles` CLI if you want to extract a smaller local basemap archive

## Development

Start the dev stack with:

```bash
docker compose up --build
```

That runs:

- `frontend` on `http://localhost:5173`
- `nginx` artifact serving on `http://localhost:3000`

Refresh local forecast artifacts with a forecast cycle:

```bash
etl/scripts/run-cycle.sh --model gfs --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --model icon --cycle <YYYYMMDDHH>
```

## Configuration

Local config lives in a repo-root `.env`. The main optional frontend dev setting
is `VITE_BASEMAP_FILENAME`.

### Optional PMTiles Basemap

The basemap is optional. If `VITE_BASEMAP_FILENAME` is unset, the frontend runs
without it.

1. Download a PMTiles build from `https://maps.protomaps.com/builds/`
2. Run `pmtiles extract --maxzoom=6 <input>.pmtiles artifacts/pmtiles/20260424.z6.pmtiles`
3. Set `VITE_BASEMAP_FILENAME=20260424.z6.pmtiles` in your repo-local `.env`
4. Run `docker compose up --build`

## Frontend Checks

Run from `frontend/`:

```bash
npm run test:run
npm run build
```

## Docs

- [frontend/README.md](frontend/README.md): frontend development, configuration, and commands.
- [frontend/src/README.md](frontend/src/README.md): frontend module boundaries and domain naming.
- [etl/README.md](etl/README.md): ETL code, local runs, artifact layout, and checks.
- [infra/README.md](infra/README.md): project infrastructure layout, prod config, and release/operator scripts.
- [artifacts/README.md](artifacts/README.md): local artifact root layout.
