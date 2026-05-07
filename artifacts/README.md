# Local Artifacts

This directory is the local development artifact root for forecast data.

It mirrors the object layout used in the production artifact bucket so the app can fetch the same paths in dev and prod.

Typical contents:

- `manifests/<model>/latest.json`
- `manifests/<model>/<cycle>.json`
- `fields/<model>/<cycle>/<fhour>/<product>.field.<dtype>.bin`
- `pmtiles/<name>.pmtiles`
- `radio/playlist.json`
- `radio/<track>.mp3`
- `status/...`

How it is used:

- `etl/scripts/local/run-cycle.sh` writes ETL outputs here.
- `compose.yml` mounts this directory into nginx at `/artifacts`.
- nginx serves `/manifests/*`, `/fields/*`, `/pmtiles/*`, and `/radio/*` directly from here.
- `pmtiles/` is the local dev location for optional PMTiles basemap archives.
- if `VITE_BASEMAP_FILENAME` is set, the frontend derives the basemap URL from `/pmtiles/<filename>`.
- `glyphs/`, `pmtiles/`, and `radio/` can be copied to the production artifact
  bucket with `infra/scripts/weather-etl/release/upload-static-artifacts.sh`.

Generated contents under this directory are ignored by git.

See [../etl/README.md](../etl/README.md) for the local and production ETL flow
that writes this layout.
