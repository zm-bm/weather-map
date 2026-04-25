# Local Artifacts

This directory is the local development artifact root for forecast data.

It mirrors the object layout used in the production artifact bucket so the app can fetch the same paths in dev and prod.

Typical contents:

- `manifests/latest.json`
- `manifests/<cycle>.json`
- `fields/<cycle>/<fhour>/<layer>.scalar.i16.bin`
- `fields/<cycle>/<fhour>/<layer>.vector.i8.bin`
- `pmtiles/<name>.pmtiles`
- `radio/<track>.mp3`
- `status/...`

How it is used:

- `etl/scripts/local/run-cycle.sh` writes ETL outputs here.
- `compose.yml` mounts this directory into nginx at `/artifacts`.
- nginx serves `/manifests/*`, `/fields/*`, `/pmtiles/*`, and `/radio/*` directly from here.
- `pmtiles/` is the local dev location for optional PMTiles basemap archives.
- if `VITE_BASEMAP_FILENAME` is set, the frontend derives the basemap URL from `/pmtiles/<filename>`.
- frontend-owned static assets such as `glyphs/` are served separately from the frontend origin.

Generated contents under this directory are ignored by git.
