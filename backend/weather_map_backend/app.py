from __future__ import annotations

from fastapi import FastAPI

from weather_map_backend.health import build_health

from .settings import load_settings

app = FastAPI(title="Weather Map API", version="0.0.0")


@app.get("/api/health")
def get_health() -> dict:
    return build_health(load_settings())


@app.get("/api/ready")
def get_ready() -> dict[str, str]:
    return {"status": "ok"}
