resource "aws_lambda_function" "ingest" {
  function_name    = "weather-etl-ingest-gfs"
  role             = aws_iam_role.ingest_lambda.arn
  runtime          = "python3.12"
  handler          = "forecast_etl.aws.gfs_ingest.handler"
  filename         = local.ingest_lambda_zip_path
  source_code_hash = filebase64sha256(local.ingest_lambda_zip_path)
  timeout          = 30

  environment {
    variables = {
      BATCH_JOB_QUEUE      = aws_batch_job_queue.etl.name
      BATCH_JOB_DEFINITION = aws_batch_job_definition.worker.arn
      PIPELINE_CONFIG_URI  = local.pipeline_config_uri
    }
  }

  tags = merge(local.tags, {
    Name = "weather-etl-ingest-gfs"
  })

  depends_on = [aws_s3_object.forecast_config]
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
