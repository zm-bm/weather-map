# Frontend

React/Vite frontend for the weather map. The app boots forecast metadata from
`/manifests/forecast-manifest.json`, renders run-scoped payloads from
`/runs/*/fields/*` through compact manifest refs, keeps a legacy `/fields/*`
fallback for old manifests, loads optional PMTiles basemaps from `/pmtiles/*`,
and serves frontend-owned static assets from `public/`.

## Development

The normal development entrypoint is the repo-root compose stack:

```bash
docker compose up --build
```

That starts:

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
- `VITE_DEV_ARTIFACT_DELAY_MS=<ms>` delays proxied local `/runs/*/fields/*` and
  `/fields/*` responses during `npm run dev`; use this to smoke-test loading
  and prefetch behavior.
- `VITE_DEV_ARTIFACT_PROXY_TARGET` is the Vite proxy target. It defaults to
  `http://localhost:3000`; compose sets it to `http://nginx:3000`.
- `VITE_DEV_API_PROXY_TARGET` is the Vite `/api/*` proxy target. It defaults to
  `http://localhost:8000`; compose sets it to `http://backend:8000`.

Glyph PBFs are generated manually by `npm run build:glyphs` from
`src/assets/glyph-fontstacks.json` into `../artifacts/glyphs/`. The command requires
the local Noto source font.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test:run
npm run preview
```

To smoke-test loading and prefetch behavior with slow frame payloads:

```bash
VITE_DEV_ARTIFACT_DELAY_MS=700 npm run dev
```

With the repo-root compose stack:

```bash
VITE_DEV_ARTIFACT_DELAY_MS=700 docker compose up --build
```

The delay only applies when the browser requests artifacts through Vite, for
example `http://localhost:5173/fields/...`. Direct nginx requests to
`http://localhost:3000/runs/...` or `http://localhost:3000/fields/...` bypass it.

## Code Notes

Domain naming and module ownership guidelines live in
[src/README.md](src/README.md).
