# Weather Map Backend

FastAPI service for public Weather Map API endpoints.

Local development reads `artifacts/status.json` by default. The compose stack
mounts artifacts and proxies `/api/*` from Vite to this service.
The backend does not import the ETL package; `status.json` is the only runtime
contract between ETL and the backend health API.

Set `ARTIFACT_ROOT_URI` to point at a different artifact root. It may be a
local path, `file://` URI, or `s3://` URI. If unset, the backend uses
`/artifacts` inside Docker when that mount exists, otherwise repo-local
`artifacts/`.

Run directly from the repo root:

```bash
scripts/bootstrap.sh
.venv/bin/uvicorn weather_map_backend.app:app --reload
```

Build the Lambda artifact:

```bash
scripts/backend-build-lambda.sh
```
