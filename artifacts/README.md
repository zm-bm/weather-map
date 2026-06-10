# Local Artifacts

This directory is the local development artifact root for forecast data.

It mirrors the object layout used in the production artifact bucket so the app can fetch the same paths in dev and prod.

Typical contents:

- `manifests/<dataset_id>/latest.json`
- `manifests/<dataset_id>/cycles/<cycle>/current.json`
- `manifests/<dataset_id>/cycles/<cycle>/runs/<run_id>.json`
- `manifests/index.json`
- `status.json`
- `runs/<dataset_id>/<cycle>/<run_id>/payloads/<frame_id>/<artifact>.<dtype>.bin`
- `runs/<dataset_id>/<cycle>/<run_id>/status/<artifact>/<frame_id>._SUCCESS.json`
- `runs/<dataset_id>/<cycle>/<run_id>/validation.json`
- `runs/<dataset_id>/<cycle>/<run_id>/manifest.json`
- `runs/<dataset_id>/<cycle>/<run_id>/publication.json`
- `pmtiles/<name>.pmtiles`
- `radio/playlist.json`
- `radio/<track>.mp3`

How it is used:

- `etl/scripts/run-cycle-local.sh` writes local ETL outputs here.
- The backend health API reads `status.json`; it does not inspect ETL internals.
- `compose.yml` mounts this directory into nginx at `/artifacts`.
- nginx serves `/manifests/*`, `/runs/*/payloads/*`, `/pmtiles/*`, and `/radio/*`
  directly from here.
- `pmtiles/` is the local dev location for optional PMTiles basemap archives.
- `glyphs/`, `pmtiles/`, and `radio/` can be copied to the production artifact
  bucket with `infra/scripts/weather-etl/release/upload-static-artifacts.sh`.

Generated contents under this directory are ignored by git.

See [../etl/README.md](../etl/README.md) for the local and production ETL flow
that writes this layout.
