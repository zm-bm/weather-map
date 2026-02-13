FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/etl

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gdal-bin \
        awscli \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ./requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ./gfs_pipeline ./etl/gfs_pipeline
COPY ./batch-run.sh ./batch-run.sh
RUN chmod +x /app/batch-run.sh

COPY pipeline_config.json /app/pipeline_config.json

ENTRYPOINT ["/app/batch-run.sh"]

