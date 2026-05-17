FROM python:3.12-slim

WORKDIR /app

COPY etl /app/etl
COPY backend /app/backend
COPY config /app/config

RUN pip install --no-cache-dir --upgrade pip "setuptools>=64" \
    && pip install --no-cache-dir --no-build-isolation -e /app/etl -e /app/backend

WORKDIR /app/backend

CMD ["uvicorn", "weather_map_backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
