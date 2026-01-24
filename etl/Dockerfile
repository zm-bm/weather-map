FROM python:3.11-slim-bookworm

RUN apt-get update
RUN apt-get install -y --no-install-recommends \
        gdal-bin \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ./requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ./etl ./etl
COPY ./run.sh ./run.sh
RUN chmod +x /app/run.sh

COPY layer_config.json /app/layer_config.json

ENTRYPOINT ["/app/run.sh"]

