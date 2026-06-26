# weather-map

## Overview

Weather forecast map app with a Vite frontend, FastAPI backend, Python ETL,
and a local nginx artifact server.

## Layout

- `frontend/` is the React/Vite MapLibre app.
- `backend/` is the FastAPI service used by frontend API routes.
- `etl/` builds forecast artifacts and has local ETL helpers.
- `infra/` has project infrastructure and production ETL config.
- `scripts/` has human/operator shell entrypoints.
- `artifacts/` is the local artifact root served by nginx in development.

## Prerequisites

- Docker with `docker compose`
- `python3` with `venv` support for Python tests and development tooling
- Optional: `pmtiles` CLI if you want to extract a smaller local basemap archive

## Development

Set up the shared Python env:

```bash
scripts/bootstrap.sh
```

Start the dev stack:

```bash
docker compose up --build
```

Services:

- `frontend` on `http://localhost:5173`
- `backend` on `http://localhost:8000`
- `nginx` artifact serving on `http://localhost:3000`

Build local forecast artifacts for a cycle:

```bash
scripts/etl-run-local.sh --dataset-id gfs --cycle <YYYYMMDDHH>
scripts/etl-run-local.sh --dataset-id icon --cycle <YYYYMMDDHH>
```

## Local Config

Local settings live in a repo-root `.env`. The main optional frontend setting is
`VITE_BASEMAP_FILENAME`.

### Optional PMTiles Basemap

The basemap is optional. Leave `VITE_BASEMAP_FILENAME` unset to run without it.

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

Run from the repo root after `scripts/bootstrap.sh`:

```bash
.venv/bin/python -m pytest etl/tests
cd etl && ../.venv/bin/ruff check weather_etl tests
cd ../backend && ../.venv/bin/python -m pytest && ../.venv/bin/ruff check weather_map_backend tests
```

## Docs

- [docs/roadmap.md](docs/roadmap.md): roadmap, near-term priorities, and
  deferred ideas.
- [config/README.md](config/README.md): forecast config model and ETL/config terms.
- [docs/ui-design-principles.md](docs/ui-design-principles.md): UI design direction.
- [frontend/README.md](frontend/README.md): frontend development, configuration, and commands.
- [frontend/src/README.md](frontend/src/README.md): frontend module boundaries and domain naming.
- [backend/README.md](backend/README.md): backend service configuration and local run command.
- [etl/README.md](etl/README.md): ETL code map, local/AWS cycle commands,
  artifact layout, and small operator guide.
- [infra/README.md](infra/README.md): project infrastructure layout, prod
  config, and release/operator scripts.
- [artifacts/README.md](artifacts/README.md): local artifact root layout.
