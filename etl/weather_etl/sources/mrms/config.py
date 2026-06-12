"""MRMS AWS S3 source config parsing."""

from __future__ import annotations

from typing import Literal

from pydantic import model_validator

from ...config.pipeline import SourceConfig
from ...config.sources import MRMS_AWS_S3_SOURCE_TYPE
from ...core.validation import FrozenModel, NonEmptyStr, parse_model
from .layout import DEFAULT_MRMS_AWS_BUCKET, DEFAULT_MRMS_AWS_PREFIX, mrms_s3_collection_uri


class MrmsAwsS3SourceSettings(FrozenModel):
    """Resolved MRMS AWS Open Data S3 acquisition settings."""

    type: Literal["mrms_aws_s3"] = MRMS_AWS_S3_SOURCE_TYPE
    grid_id: NonEmptyStr
    bucket: NonEmptyStr = DEFAULT_MRMS_AWS_BUCKET
    prefix: NonEmptyStr = DEFAULT_MRMS_AWS_PREFIX

    @model_validator(mode="after")
    def _validate_source(self) -> "MrmsAwsS3SourceSettings":
        if not self.normalized_bucket:
            raise ValueError("bucket must not be empty after trimming slashes")
        if not self.normalized_prefix:
            raise ValueError("prefix must not be empty after trimming slashes")
        return self

    @property
    def normalized_bucket(self) -> str:
        return self.bucket.strip("/")

    @property
    def normalized_prefix(self) -> str:
        return self.prefix.strip("/")

    @property
    def collection_uri(self) -> str:
        return mrms_s3_collection_uri(bucket=self.normalized_bucket, prefix=self.normalized_prefix)


def parse_mrms_aws_s3_source(source: SourceConfig) -> MrmsAwsS3SourceSettings:
    """Parse a generic source config into MRMS S3 settings."""

    return parse_model(MrmsAwsS3SourceSettings, source.raw)
