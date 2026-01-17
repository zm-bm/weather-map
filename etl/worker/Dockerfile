FROM python:3.11-slim-bookworm

RUN apt-get update
RUN apt-get install -y --no-install-recommends \
        gdal-bin \
        python3-gdal \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker/src ./src
COPY worker/run.sh ./run.sh
RUN chmod +x /app/run.sh

# Bake layer config into the image for production-friendly deploys
COPY layer_config.json /app/layer_config.json

ENTRYPOINT ["/app/run.sh"]
