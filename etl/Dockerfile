FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV FORECAST_ETL_DIR=/app/etl
ENV PIPELINE_CONFIG_URI=file:///app/etl/forecast.etl_config.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gdal-bin \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ./pyproject.toml ./etl/pyproject.toml
COPY ./forecast_etl ./etl/forecast_etl
COPY forecast.etl_config.json /app/etl/forecast.etl_config.json

RUN pip install --no-cache-dir --upgrade pip "setuptools>=64" \
    && pip install --no-cache-dir --no-build-isolation ./etl

ENTRYPOINT ["forecast-etl"]
CMD ["run-hour"]
