variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Deployment environment label used in default names and tags."
}

variable "name_prefix" {
  type        = string
  default     = "weather-etl"
  description = "Prefix for ETL resource names."
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

variable "artifacts_bucket_name" {
  type        = string
  default     = null
  description = "Optional artifact bucket name. Defaults to <name_prefix>-artifacts-<environment>-<account_id>."
}

variable "config_bucket_name" {
  type        = string
  default     = null
  description = "Optional config bucket name. Defaults to <name_prefix>-config-<environment>-<account_id>."
}

variable "worker_image_tag" {
  type        = string
  default     = "latest"
  description = "Worker image tag used by Batch job definitions."
}

variable "batch_max_vcpus" {
  type        = number
  default     = 16
  description = "Maximum vCPUs for the managed Batch compute environment."
}

variable "batch_retry_attempts" {
  type        = number
  default     = 3
  description = "Retry attempts for ETL Batch jobs."
}

variable "batch_log_retention_days" {
  type        = number
  default     = 14
  description = "Retention window for Batch worker logs."
}

variable "gfs_worker_memory_mib" {
  type        = number
  default     = 2048
  description = "Memory for GFS Batch hour workers."
}

variable "icon_worker_memory_mib" {
  type        = number
  default     = 8192
  description = "Memory for ICON Batch hour workers."
}

variable "gfs_worker_timeout_seconds" {
  type        = number
  default     = 7200
  description = "Attempt timeout for GFS Batch hour workers."
}

variable "icon_worker_timeout_seconds" {
  type        = number
  default     = 14400
  description = "Attempt timeout for ICON Batch hour workers."
}

variable "gfs_ingest_timeout_seconds" {
  type        = number
  default     = 30
  description = "Timeout for the GFS ingest Lambda."
}

variable "icon_ingest_timeout_seconds" {
  type        = number
  default     = 300
  description = "Timeout for the ICON ingest Lambda."
}

variable "publisher_timeout_seconds" {
  type        = number
  default     = 300
  description = "Timeout for the scheduled publisher Lambda."
}

variable "observability_timeout_seconds" {
  type        = number
  default     = 60
  description = "Timeout for the read-only ETL observability Lambda."
}

variable "icon_ingest_schedule_expression" {
  type        = string
  default     = "rate(10 minutes)"
  description = "EventBridge schedule for ICON source polling."
}

variable "publisher_schedule_expression" {
  type        = string
  default     = "rate(10 minutes)"
  description = "EventBridge schedule for publisher reconciliation."
}

variable "observability_schedule_expression" {
  type        = string
  default     = "rate(15 minutes)"
  description = "EventBridge schedule for read-only ETL observability checks."
}

variable "icon_poll_cycle_count" {
  type        = number
  default     = 1
  description = "Recent ICON cycle count scanned by the poller."
}

variable "publisher_datasets" {
  type        = list(string)
  default     = ["gfs", "icon"]
  description = "Datasets scanned by the scheduled publisher."
}

variable "publisher_cycle_count" {
  type        = number
  default     = 8
  description = "Recent synoptic cycle count scanned by the scheduled publisher."
}

variable "observability_metric_namespace" {
  type        = string
  default     = "WeatherMap/ETL"
  description = "CloudWatch custom metric namespace for ETL observability metrics."
}

variable "observability_alarm_evaluation_periods" {
  type        = number
  default     = 2
  description = "Evaluation periods for stable ETL artifact-state alarms."
}

variable "observability_alert_email" {
  type        = string
  description = "Required email address subscribed to ETL production alarm notifications."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.observability_alert_email))
    error_message = "observability_alert_email must be a valid email address."
  }
}

variable "run_retention_days" {
  type        = number
  default     = 14
  description = "S3 lifecycle expiration window for run-scoped artifacts."
}

variable "manifest_retention_days" {
  type        = number
  default     = 45
  description = "S3 lifecycle expiration window for public manifests."
}

variable "noncurrent_version_retention_days" {
  type        = number
  default     = 7
  description = "S3 noncurrent version retention for lifecycle-managed prefixes."
}
