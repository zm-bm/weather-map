locals {
  environment = var.environment
  name_prefix = var.name_prefix

  state_bucket = "zmbm-tf-state-bucket"
  state_region = "us-east-1"
  state_keys = {
    network = "network.tfstate"
  }
}

locals {
  artifacts_bucket_resource_name = coalesce(var.artifacts_bucket_name, "${local.name_prefix}-artifacts-${local.environment}-${data.aws_caller_identity.current.account_id}")
  config_bucket_resource_name    = coalesce(var.config_bucket_name, "${local.name_prefix}-config-${local.environment}-${data.aws_caller_identity.current.account_id}")

  artifacts_bucket_name = aws_s3_bucket.artifacts.bucket
  config_bucket_name    = aws_s3_bucket.config.bucket

  artifact_root_uri = "s3://${local.artifacts_bucket_name}"

  pipeline_path = abspath("${path.root}/../../../config/pipeline.json")
  pipeline_key  = "${local.name_prefix}/pipeline.json"
  pipeline_uri  = "s3://${local.config_bucket_name}/${local.pipeline_key}"

  catalog_path = abspath("${path.root}/../../../config/catalog.json")
  catalog_key  = "${local.name_prefix}/catalog.json"
  catalog_uri  = "s3://${local.config_bucket_name}/${local.catalog_key}"
}

locals {
  shared_lambda_zip_path = var.ingest_lambda_zip_path != null ? var.ingest_lambda_zip_path : abspath("${path.root}/../../../etl/dist/weather-etl-ingest-lambda.zip")
  shared_lambda_zip_hash = filebase64sha256(local.shared_lambda_zip_path)

  gfs_sns_topic_arn = var.gfs_sns_topic_arn
}

locals {
  names = {
    batch_compute_environment  = "${local.name_prefix}-fargate-spot"
    batch_log_group            = "/aws/batch/${local.name_prefix}"
    batch_queue                = local.name_prefix
    batch_security_group       = "${local.name_prefix}-batch-tasks"
    batch_service_role         = "${local.name_prefix}-batch-service-role"
    batch_task_execution_role  = "${local.name_prefix}-batch-task-execution-role"
    batch_job_role             = "${local.name_prefix}-batch-job-role"
    batch_job_policy           = "${local.name_prefix}-batch-job-s3"
    worker_repository          = "${local.name_prefix}-worker"
    worker_gfs_job_definition  = "${local.name_prefix}-worker"
    worker_icon_job_definition = "${local.name_prefix}-worker-icon"

    gfs_ingest_lambda = "${local.name_prefix}-ingest-gfs"
    gfs_ingest_role   = "${local.name_prefix}-ingest-lambda-role"
    gfs_ingest_policy = "${local.name_prefix}-ingest-lambda-policy"

    icon_ingest_lambda   = "${local.name_prefix}-ingest-icon"
    icon_ingest_role     = "${local.name_prefix}-ingest-icon-lambda-role"
    icon_ingest_policy   = "${local.name_prefix}-ingest-icon-lambda-policy"
    icon_ingest_schedule = "${local.name_prefix}-ingest-icon-poll"

    publisher_lambda   = "${local.name_prefix}-publisher"
    publisher_role     = "${local.name_prefix}-publisher-lambda-role"
    publisher_policy   = "${local.name_prefix}-publisher-lambda-policy"
    publisher_schedule = "${local.name_prefix}-publisher-schedule"

    observability_alert_topic      = "${local.name_prefix}-alerts"
    batch_failed_event_rule        = "${local.name_prefix}-batch-failed"
    batch_queue_blocked_event_rule = "${local.name_prefix}-batch-queue-blocked"

    run_coordinator_table = "${local.name_prefix}-run-coordinator"
    frame_claim_table     = "${local.name_prefix}-frame-claims"
  }
}

locals {
  tags = {
    app       = "weather-map"
    ManagedBy = "terraform"
    Stack     = local.name_prefix
    env       = local.environment
  }
}
