resource "aws_iam_role" "publisher_lambda" {
  name               = local.names.publisher_role
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.publisher_role
  })
}

data "aws_iam_policy_document" "publisher_lambda" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.artifacts_bucket_name}"]
  }

  statement {
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::${local.config_bucket_name}/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/runs/*"
    ]
  }

  statement {
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/runs/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/status.json"
    ]
  }

}

resource "aws_iam_role_policy" "publisher_lambda" {
  name   = local.names.publisher_policy
  role   = aws_iam_role.publisher_lambda.id
  policy = data.aws_iam_policy_document.publisher_lambda.json
}

resource "aws_lambda_function" "publisher" {
  function_name    = local.names.publisher_lambda
  role             = aws_iam_role.publisher_lambda.arn
  runtime          = "python3.12"
  handler          = "weather_etl.adapters.aws.publisher_lambda.handler"
  filename         = local.shared_lambda_zip_path
  source_code_hash = local.shared_lambda_zip_hash
  timeout          = var.publisher_timeout_seconds
  memory_size      = 256

  environment {
    variables = {
      ARTIFACT_ROOT_URI            = local.artifact_root_uri
      CATALOG_URI                  = local.catalog_uri
      PIPELINE_URI                 = local.pipeline_uri
      PUBLISH_DATASETS             = join(",", var.publisher_datasets)
      PUBLISH_FORECAST_CYCLE_COUNT = tostring(var.publisher_forecast_cycle_count)
    }
  }

  tags = merge(local.tags, {
    Name = local.names.publisher_lambda
  })

  depends_on = [aws_s3_object.pipeline, aws_s3_object.catalog]
}

resource "aws_cloudwatch_event_rule" "publisher_schedule" {
  name                = local.names.publisher_schedule
  description         = "Publish completed ETL cycle manifests"
  schedule_expression = var.publisher_schedule_expression

  tags = merge(local.tags, {
    Name = local.names.publisher_schedule
  })
}

resource "aws_cloudwatch_event_target" "publisher_schedule" {
  rule = aws_cloudwatch_event_rule.publisher_schedule.name
  arn  = aws_lambda_function.publisher.arn
}

resource "aws_lambda_permission" "allow_eventbridge_publisher" {
  statement_id_prefix = "AllowExecutionFromEventBridgePublisher-"
  action              = "lambda:InvokeFunction"
  function_name       = aws_lambda_function.publisher.function_name
  principal           = "events.amazonaws.com"
  source_arn          = aws_cloudwatch_event_rule.publisher_schedule.arn

  lifecycle {
    create_before_destroy = true
  }
}
