# Weather Map Backend

FastAPI service for public Weather Map API endpoints.

Local development reads:

- `ARTIFACT_ROOT_URI=file:///artifacts`
- `PIPELINE_CONFIG_URI=file:///config/forecast.etl_config.json`

The compose stack mounts those paths and proxies `/api/*` from Vite to this
service.

Run directly from the repo root:

```bash
etl/scripts/bootstrap.sh
ARTIFACT_ROOT_URI="file://$(pwd)/artifacts" \
PIPELINE_CONFIG_URI="file://$(pwd)/infra/config/forecast.etl_config.json" \
.venv/bin/uvicorn weather_map_backend.app:app --reload
```

Build the Lambda artifact:

```bash
infra/scripts/backend/release/build-lambda-zip.sh
```
