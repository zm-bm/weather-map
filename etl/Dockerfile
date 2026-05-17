FROM deutscherwetterdienst/regrid:icon AS dwd_regrid

FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV FORECAST_ETL_DIR=/app/etl
ENV ICON_REGRID_DESCRIPTION_FILE=/opt/dwd-regrid/descriptions/icon/icon_description.txt
ENV ICON_REGRID_WEIGHTS_FILE=/opt/dwd-regrid/weights/icon/icon_weights.nc

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        cdo \
        gdal-bin \
        libeccodes-tools \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p /opt/dwd-regrid/descriptions/icon /opt/dwd-regrid/weights/icon

COPY --from=dwd_regrid /data/descriptions/icon/icon_description.txt /opt/dwd-regrid/descriptions/icon/icon_description.txt
COPY --from=dwd_regrid /data/weights/icon/icon_weights.nc /opt/dwd-regrid/weights/icon/icon_weights.nc

COPY etl/pyproject.toml ./etl/pyproject.toml
COPY etl/forecast_etl ./etl/forecast_etl
COPY config ./config

RUN pip install --no-cache-dir --upgrade pip "setuptools>=64" \
    && pip install --no-cache-dir --no-build-isolation ./etl

ENTRYPOINT ["forecast-etl"]
CMD ["run-hour"]
