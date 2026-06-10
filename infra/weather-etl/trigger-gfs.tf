resource "aws_lambda_function" "ingest" {
  function_name    = local.names.gfs_ingest_lambda
  role             = aws_iam_role.ingest_lambda.arn
  runtime          = "python3.12"
  handler          = "weather_etl.adapters.aws.gfs_ingest_lambda.handler"
  filename         = local.shared_lambda_zip_path
  source_code_hash = local.shared_lambda_zip_hash
  timeout          = var.gfs_ingest_timeout_seconds

  environment {
    variables = {
      BATCH_JOB_QUEUE       = aws_batch_job_queue.etl.name
      BATCH_JOB_DEFINITION  = aws_batch_job_definition.worker.arn
      ARTIFACT_ROOT_URI     = local.artifact_root_uri
      FRAME_CLAIM_TABLE     = aws_dynamodb_table.frame_claims.name
      PIPELINE_URI          = local.pipeline_uri
      CATALOG_URI           = local.catalog_uri
      RUN_COORDINATOR_TABLE = aws_dynamodb_table.run_coordinator.name
    }
  }

  tags = merge(local.tags, {
    Name = local.names.gfs_ingest_lambda
  })

  depends_on = [aws_s3_object.pipeline, aws_s3_object.catalog]
}

resource "aws_sns_topic_subscription" "ingest" {
  topic_arn = local.gfs_sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.ingest.arn

  depends_on = [aws_lambda_permission.allow_sns]
}

resource "aws_lambda_permission" "allow_sns" {
  statement_id_prefix = "AllowExecutionFromNoaaGfsSns-"
  action              = "lambda:InvokeFunction"
  function_name       = aws_lambda_function.ingest.function_name
  principal           = "sns.amazonaws.com"
  source_arn          = local.gfs_sns_topic_arn

  lifecycle {
    create_before_destroy = true
  }
}
