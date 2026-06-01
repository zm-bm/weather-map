variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "gfs_sns_topic_arn" {
  type    = string
  default = "arn:aws:sns:us-east-1:123901341784:NewGFSObject"
}

variable "ingest_lambda_zip_path" {
  type        = string
  default     = null
  description = "Optional override for the built ingest Lambda zip. Defaults to the repo-local etl/dist/weather-etl-ingest-lambda.zip."
}

locals {
  environment = "prod"

  state_bucket = "zmbm-tf-state-bucket"
  state_region = "us-east-1"
  state_keys = {
    network = "network.tfstate"
  }
}

locals {
  artifacts_bucket_resource_name = "weather-etl-artifacts-prod-${data.aws_caller_identity.current.account_id}"
  config_bucket_resource_name    = "weather-etl-config-prod-${data.aws_caller_identity.current.account_id}"

  artifacts_bucket_name = aws_s3_bucket.artifacts.bucket
  config_bucket_name    = aws_s3_bucket.config.bucket

  pipeline_config_path = abspath("${path.root}/../../../config/pipeline/base.json")
  pipeline_config_key  = "weather-etl/pipeline_config.json"
  pipeline_config_uri  = "s3://${local.config_bucket_name}/${local.pipeline_config_key}"

  forecast_catalog_path = abspath("${path.root}/../../../config/forecast_catalog.json")
  forecast_catalog_key  = "weather-etl/forecast_catalog.json"
  forecast_catalog_uri  = "s3://${local.config_bucket_name}/${local.forecast_catalog_key}"
}

locals {
  ingest_lambda_zip_path = var.ingest_lambda_zip_path != null ? var.ingest_lambda_zip_path : abspath("${path.root}/../../../etl/dist/weather-etl-ingest-lambda.zip")
  gfs_sns_topic_arn      = var.gfs_sns_topic_arn
}

locals {
  tags = {
    app       = "weather-map"
    ManagedBy = "terraform"
    Stack     = "weather-etl"
    env       = local.environment
  }
}
