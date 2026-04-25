FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/etl

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gdal-bin \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ./requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ./gfs_pipeline ./etl/gfs_pipeline
COPY gfs.etl_config.json /app/gfs.etl_config.json

ENTRYPOINT ["python", "-u", "-m", "gfs_pipeline.cli"]
CMD ["run-hour"]
