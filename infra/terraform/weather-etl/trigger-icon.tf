resource "aws_dynamodb_table" "icon_ingest_state" {
  name         = "weather-etl-icon-ingest-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge(local.tags, {
    Name = "weather-etl-icon-ingest-state"
  })
}

resource "aws_iam_role" "ingest_icon_lambda" {
  name = "weather-etl-ingest-icon-lambda-role"

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
    Name = "weather-etl-ingest-icon-lambda-role"
  })
}

resource "aws_iam_role_policy" "ingest_icon_lambda" {
  name = "weather-etl-ingest-icon-lambda-policy"
  role = aws_iam_role.ingest_icon_lambda.id

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
          "batch:SubmitJob"
        ]
        Resource = [
          aws_batch_job_definition.worker_icon.arn,
          aws_batch_job_queue.etl.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.icon_ingest_state.arn,
          aws_dynamodb_table.run_coordinator.arn
        ]
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
          "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/icon/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/runs/icon/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/status/icon/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/icon/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/runs/icon/*",
          "arn:aws:s3:::${local.artifacts_bucket_name}/status/icon/*"
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "ingest_icon" {
  function_name    = "weather-etl-ingest-icon"
  role             = aws_iam_role.ingest_icon_lambda.arn
  runtime          = "python3.12"
  handler          = "forecast_etl.aws.icon_ingest.handler"
  filename         = local.ingest_lambda_zip_path
  source_code_hash = filebase64sha256(local.ingest_lambda_zip_path)
  timeout          = 300
  memory_size      = 256

  environment {
    variables = {
      ARTIFACT_ROOT_URI     = "s3://${local.artifacts_bucket_name}"
      BATCH_JOB_QUEUE       = aws_batch_job_queue.etl.name
      BATCH_JOB_DEFINITION  = aws_batch_job_definition.worker_icon.arn
      ICON_POLL_CYCLE_COUNT = "1"
      ICON_STATE_TABLE      = aws_dynamodb_table.icon_ingest_state.name
      PIPELINE_CONFIG_URI   = local.pipeline_config_uri
      RUN_COORDINATOR_TABLE = aws_dynamodb_table.run_coordinator.name
    }
  }

  tags = merge(local.tags, {
    Name = "weather-etl-ingest-icon"
  })

  depends_on = [aws_s3_object.forecast_config]
}

resource "aws_cloudwatch_event_rule" "ingest_icon_poll" {
  name                = "weather-etl-ingest-icon-poll"
  description         = "Poll DWD ICON file readiness and submit ETL jobs"
  schedule_expression = "rate(10 minutes)"

  tags = merge(local.tags, {
    Name = "weather-etl-ingest-icon-poll"
  })
}

resource "aws_cloudwatch_event_target" "ingest_icon_poll" {
  rule = aws_cloudwatch_event_rule.ingest_icon_poll.name
  arn  = aws_lambda_function.ingest_icon.arn
}

resource "aws_lambda_permission" "allow_eventbridge_icon" {
  statement_id_prefix = "AllowExecutionFromEventBridgeIcon-"
  action              = "lambda:InvokeFunction"
  function_name       = aws_lambda_function.ingest_icon.function_name
  principal           = "events.amazonaws.com"
  source_arn          = aws_cloudwatch_event_rule.ingest_icon_poll.arn

  lifecycle {
    create_before_destroy = true
  }
}
