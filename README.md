# weather-map

## Overview

Weather forecast map app with a Vite frontend, FastAPI backend, forecast
ETL, and nginx artifact server for development.

## Layout

- `frontend/` is the React/Vite MapLibre app.
- `backend/` is the FastAPI service used by frontend API routes.
- `etl/` owns forecast artifact generation and local ETL helpers.
- `infra/` owns project infrastructure, production ETL config, and production
  release/operator scripts.
- `artifacts/` is the local artifact root served by nginx in development.

## Prerequisites

- Docker with `docker compose`
- `python3` with `venv` support for Python tests and development tooling
- Optional: `pmtiles` CLI if you want to extract a smaller local basemap archive

## Development

Set up the shared Python development environment with:

```bash
etl/scripts/bootstrap.sh
```

Start the dev stack with:

```bash
docker compose up --build
```

That runs:

- `frontend` on `http://localhost:5173`
- `backend` on `http://localhost:8000`
- `nginx` artifact serving on `http://localhost:3000`

Refresh local forecast artifacts with a forecast cycle:

```bash
etl/scripts/run-cycle-local.sh --dataset-id gfs --cycle <YYYYMMDDHH>
etl/scripts/run-cycle-local.sh --dataset-id icon --cycle <YYYYMMDDHH>
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

## Python Checks

Run from the repo root after `etl/scripts/bootstrap.sh`:

```bash
.venv/bin/python -m pytest etl/tests
cd etl && ../.venv/bin/ruff check weather_etl tests
cd ../backend && ../.venv/bin/python -m pytest && ../.venv/bin/ruff check weather_map_backend tests
```

## Docs

- [docs/roadmap.md](docs/roadmap.md): current Weather Map roadmap, near-term priorities, and deferred ideas.
- [docs/terminology.md](docs/terminology.md): shared Weather Map vocabulary for layers, artifacts, fields, time slices, and render channels.
- [docs/forecast-config.md](docs/forecast-config.md): guide to the two-file forecast config model, product layers, artifacts, and dataset support.
- [frontend/README.md](frontend/README.md): frontend development, configuration, and commands.
- [frontend/src/README.md](frontend/src/README.md): frontend module boundaries and domain naming.
- [backend/README.md](backend/README.md): backend service configuration and local run command.
- [etl/README.md](etl/README.md): ETL code map, local/AWS cycle commands, artifact layout, and small operator guide.
- [infra/README.md](infra/README.md): project infrastructure layout, prod config, and release/operator scripts.
- [artifacts/README.md](artifacts/README.md): local artifact root layout.
