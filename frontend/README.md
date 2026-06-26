# Frontend

React/Vite app for the weather map. It reads forecast metadata from
`/manifests/index.json`, payloads from `/runs/*/payloads/*`, optional PMTiles
basemaps from `/pmtiles/*`, and static frontend assets from `public/`.

## Development

Use the repo-root compose stack for normal local work:

```bash
docker compose up --build
```

Services:

- Vite frontend: `http://localhost:5173`
- backend API: `http://localhost:8000`
- nginx artifact server: `http://localhost:3000`

## Configuration

Runtime config is read from Vite env variables:

- `VITE_ARTIFACT_BASE_URL` defaults to the frontend origin. The compose stack
  uses `http://localhost:5173` so local artifact requests pass through Vite
  before being proxied to nginx.
- `VITE_BASEMAP_FILENAME` enables an optional PMTiles basemap served from
  `/pmtiles/<filename>`.
- `VITE_DEV_ARTIFACT_DELAY_MS=<ms>` delays proxied local payloads during
  `npm run dev`; useful for loading/prefetch smoke tests.
- `VITE_DEV_ARTIFACT_PROXY_TARGET` is the Vite proxy target. It defaults to
  `http://localhost:3000`; compose sets it to `http://nginx:3000`.
- `VITE_DEV_API_PROXY_TARGET` is the Vite `/api/*` proxy target. It defaults to
  `http://localhost:8000`; compose sets it to `http://backend:8000`.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test:run
npm run preview
```

Test loading behavior with slow payloads:

```bash
VITE_DEV_ARTIFACT_DELAY_MS=700 npm run dev
```

With the repo-root compose stack:

```bash
VITE_DEV_ARTIFACT_DELAY_MS=700 docker compose up --build
```

The delay only applies when the browser requests artifacts through Vite, for
example `http://localhost:5173/runs/...`. Direct nginx requests to
`http://localhost:3000/runs/...` bypass it.

## Code Notes

Domain naming and the module map live in [src/README.md](src/README.md).
