# Weather Map Backend

FastAPI service for public Weather Map API endpoints.

Local development reads `artifacts/` and `config/pipeline/base.json` by default.
The compose stack mounts those paths and proxies `/api/*` from Vite to this
service.

Run directly from the repo root:

```bash
etl/scripts/bootstrap.sh
.venv/bin/uvicorn weather_map_backend.app:app --reload
```

Build the Lambda artifact:

```bash
infra/scripts/backend/release/build-lambda-zip.sh
```
