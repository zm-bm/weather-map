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

How it is used:

- `scripts/etl-fetch-run.sh` copies completed run outputs here for local dev.
- The backend health API reads `status.json`; it does not inspect ETL internals.
- `compose.yml` mounts this directory into nginx at `/artifacts`.
- nginx serves `/manifests/*`, `/runs/*/payloads/*`, and `/pmtiles/*`
  directly from here.
- `pmtiles/` is the local dev location for optional PMTiles basemap archives.
- `glyphs/` and `pmtiles/` can be copied to the production artifact
  bucket with `scripts/etl-deploy.sh --upload-static`.

Generated contents under this directory are ignored by git.

See [../etl/README.md](../etl/README.md) for the ETL submission and fetch flow
that uses this layout.
