output "artifacts_bucket_name" {
  value = local.artifacts_bucket_name
}

output "config_bucket_name" {
  value = local.config_bucket_name
}

output "pipeline_config_uri" {
  value = local.pipeline_config_uri
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

output "icon_batch_job_definition_arn" {
  value = aws_batch_job_definition.worker_icon.arn
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
