output "artifacts_bucket_name" {
  value = local.artifacts_bucket_name
}

output "config_bucket_name" {
  value = local.config_bucket_name
}

output "pipeline_uri" {
  value = local.pipeline_uri
}

output "catalog_uri" {
  value = local.catalog_uri
}

output "artifact_root_uri" {
  value = local.artifact_root_uri
}

output "worker_ecr_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "batch_job_queue_name" {
  value = aws_batch_job_queue.etl.name
}

output "batch_job_definition_arn" {
  value = aws_batch_job_definition.worker.arn
}

output "gfs_batch_job_definition_arn" {
  value = aws_batch_job_definition.worker.arn
}

output "icon_batch_job_definition_arn" {
  value = aws_batch_job_definition.worker_icon.arn
}

output "mrms_batch_job_definition_arn" {
  value = aws_batch_job_definition.worker_mrms.arn
}

output "frame_claim_table_name" {
  value = aws_dynamodb_table.frame_claims.name
}

output "ingest_lambda_name" {
  value = aws_lambda_function.ingest.function_name
}

output "ingest_lambda_arn" {
  value = aws_lambda_function.ingest.arn
}

output "icon_ingest_lambda_name" {
  value = aws_lambda_function.ingest_icon.function_name
}

output "icon_ingest_lambda_arn" {
  value = aws_lambda_function.ingest_icon.arn
}

output "mrms_ingest_lambda_name" {
  value = aws_lambda_function.ingest_mrms.function_name
}

output "mrms_ingest_lambda_arn" {
  value = aws_lambda_function.ingest_mrms.arn
}

output "mrms_ingest_queue_arn" {
  value = aws_sqs_queue.mrms_ingest.arn
}

output "mrms_ingest_dlq_arn" {
  value = aws_sqs_queue.mrms_ingest_dlq.arn
}

output "publisher_lambda_name" {
  value = aws_lambda_function.publisher.function_name
}

output "publisher_lambda_arn" {
  value = aws_lambda_function.publisher.arn
}

output "observability_alert_topic_arn" {
  value = aws_sns_topic.observability_alerts.arn
}

output "etl_runtime_contract" {
  value = {
    artifact_root_uri = local.artifact_root_uri
    pipeline_uri      = local.pipeline_uri
    catalog_uri       = local.catalog_uri

    storage = {
      artifacts_bucket_name = local.artifacts_bucket_name
      config_bucket_name    = local.config_bucket_name
    }

    run_coordinator = {
      table_name = aws_dynamodb_table.run_coordinator.name
      table_arn  = aws_dynamodb_table.run_coordinator.arn
    }

    frame_claims = {
      table_name = aws_dynamodb_table.frame_claims.name
      table_arn  = aws_dynamodb_table.frame_claims.arn
    }

    batch = {
      queue_name                = aws_batch_job_queue.etl.name
      queue_arn                 = aws_batch_job_queue.etl.arn
      gfs_job_definition_arn    = aws_batch_job_definition.worker.arn
      icon_job_definition_arn   = aws_batch_job_definition.worker_icon.arn
      mrms_job_definition_arn   = aws_batch_job_definition.worker_mrms.arn
      worker_ecr_repository_url = aws_ecr_repository.worker.repository_url
      worker_image_tag          = var.worker_image_tag
      retry_attempts            = var.batch_retry_attempts
      gfs_timeout_seconds       = var.gfs_worker_timeout_seconds
      icon_timeout_seconds      = var.icon_worker_timeout_seconds
      mrms_timeout_seconds      = var.mrms_worker_timeout_seconds
    }

    ingest = {
      gfs_lambda_name       = aws_lambda_function.ingest.function_name
      gfs_lambda_arn        = aws_lambda_function.ingest.arn
      gfs_sns_topic_arn     = local.gfs_sns_topic_arn
      icon_lambda_name      = aws_lambda_function.ingest_icon.function_name
      icon_lambda_arn       = aws_lambda_function.ingest_icon.arn
      icon_schedule_name    = aws_cloudwatch_event_rule.ingest_icon_poll.name
      icon_schedule         = var.icon_ingest_schedule_expression
      icon_poll_cycle_count = var.icon_poll_cycle_count
      mrms_lambda_name      = aws_lambda_function.ingest_mrms.function_name
      mrms_lambda_arn       = aws_lambda_function.ingest_mrms.arn
      mrms_sns_topic_arn    = local.mrms_sns_topic_arn
      mrms_queue_arn        = aws_sqs_queue.mrms_ingest.arn
      mrms_dlq_arn          = aws_sqs_queue.mrms_ingest_dlq.arn
      mrms_source_bucket    = "noaa-mrms-pds"
      mrms_source_prefix    = "CONUS"
    }

    publisher = {
      lambda_name          = aws_lambda_function.publisher.function_name
      lambda_arn           = aws_lambda_function.publisher.arn
      schedule_name        = aws_cloudwatch_event_rule.publisher_schedule.name
      schedule             = var.publisher_schedule_expression
      datasets             = var.publisher_datasets
      forecast_cycle_count = var.publisher_forecast_cycle_count
    }

    observability = {
      alert_topic_arn = aws_sns_topic.observability_alerts.arn
      alert_email     = var.observability_alert_email
    }

    retention = {
      run_days                 = var.run_retention_days
      manifest_days            = var.manifest_retention_days
      mrms_run_days            = var.mrms_run_retention_days
      mrms_cycle_manifest_days = var.mrms_cycle_manifest_retention_days
      noncurrent_version_days  = var.noncurrent_version_retention_days
      batch_log_days           = var.batch_log_retention_days
    }
  }
}
