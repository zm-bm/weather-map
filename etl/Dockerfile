ARG ETL_BASE_IMAGE=weather-map-etl-base:local

FROM ${ETL_BASE_IMAGE}

COPY etl/pyproject.toml ./etl/pyproject.toml
COPY etl/weather_etl ./etl/weather_etl

RUN pip install --no-cache-dir --upgrade pip "setuptools>=64" \
    && pip install --no-cache-dir --no-build-isolation ./etl

ARG ETL_CODE_REVISION=unknown
ARG ETL_IMAGE_IDENTITY=unknown

ENV ETL_CODE_REVISION=${ETL_CODE_REVISION}
ENV ETL_IMAGE_IDENTITY=${ETL_IMAGE_IDENTITY}

ENTRYPOINT ["weather-etl"]
CMD ["run-frame"]
