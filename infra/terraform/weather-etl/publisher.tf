resource "aws_iam_role" "publisher_lambda" {
  name = "weather-etl-publisher-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.tags, {
    Name = "weather-etl-publisher-lambda-role"
  })
}

resource "aws_iam_role_policy" "publisher_lambda" {
  name = "weather-etl-publisher-lambda-policy"
  role = aws_iam_role.publisher_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${local.artifacts_bucket_name}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [
          "arn:aws:s3:::${local.config_bucket_name}/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/runs/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/status/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/runs/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/status/*"
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "publisher" {
  function_name    = "weather-etl-publisher"
  role             = aws_iam_role.publisher_lambda.arn
  runtime          = "python3.12"
  handler          = "forecast_etl.aws.publisher.handler"
  filename         = local.ingest_lambda_zip_path
  source_code_hash = filebase64sha256(local.ingest_lambda_zip_path)
  timeout          = 300
  memory_size      = 256

  environment {
    variables = {
      ARTIFACT_ROOT_URI   = "s3://${local.artifacts_bucket_name}"
      PIPELINE_CONFIG_URI = local.pipeline_config_uri
      PUBLISH_MODELS      = "gfs,icon"
      PUBLISH_CYCLE_COUNT = "8"
    }
  }

  tags = merge(local.tags, {
    Name = "weather-etl-publisher"
  })

  depends_on = [aws_s3_object.forecast_config]
}

resource "aws_cloudwatch_event_rule" "publisher_schedule" {
  name                = "weather-etl-publisher-schedule"
  description         = "Publish completed ETL cycle manifests"
  schedule_expression = "rate(10 minutes)"

  tags = merge(local.tags, {
    Name = "weather-etl-publisher-schedule"
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
