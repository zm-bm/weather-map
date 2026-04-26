# Frontend

React/Vite frontend for the weather map. The app renders forecast artifacts from
`/manifests/*` and `/fields/*`, optional PMTiles basemaps from `/pmtiles/*`, and
frontend-owned static assets from `public/`.

## Development

The normal development entrypoint is the repo-root compose stack:

```bash
docker compose up --build
```

That starts:

- Vite frontend: `http://localhost:5173`
- nginx artifact server: `http://localhost:3000`

## Configuration

Runtime config is read from Vite env variables:

- `VITE_ARTIFACT_BASE_URL` defaults to the frontend origin. The compose stack
  sets it to `http://localhost:3000`.
- `VITE_BASEMAP_FILENAME` enables an optional PMTiles basemap served from
  `/pmtiles/<filename>`.
- `VITE_VERIFY_PAYLOAD_SHA256=true` enables forecast payload hash checks.

Glyph PBFs are generated before dev/build by `npm run build:glyphs` from
`src/assets/glyph-fontstacks.json` into `public/glyphs/`.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test:run
npm run preview
```

## Code Notes

Domain naming and module ownership guidelines live in
[src/README.md](src/README.md).
