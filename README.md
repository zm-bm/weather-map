# weather-map

## Overview

Weather forecast map app with a Vite frontend, a local forecast ETL, and an
nginx artifact server for development.

## Layout

- `frontend/` is the React/Vite MapLibre app.
- `etl/` owns forecast artifact generation and release helpers.
- `artifacts/` is the local artifact root served by nginx in development.
- A private infra checkout owns production ETL deployment, production config,
  and AWS operator scripts under `stacks/weather-etl/`.

## Prerequisites

- Docker with `docker compose`
- `python3` with `venv` support for local ETL runs
- GDAL CLI tools for local ETL runs (`gdalinfo`, `gdal_translate`, `gdalwarp`)
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
etl/scripts/local/run-cycle.sh --cycle <cycle>
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
- [etl/README.md](etl/README.md): ETL local runs, publishing, production release, and checks.
- [artifacts/README.md](artifacts/README.md): local artifact root layout.
