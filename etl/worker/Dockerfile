FROM python:3.11-slim-bookworm

RUN apt-get update
RUN apt-get install -y --no-install-recommends \
        gdal-bin \
        python3-gdal \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY run.sh ./run.sh
RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
