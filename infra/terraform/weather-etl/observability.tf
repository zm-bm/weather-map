locals {
  lambda_error_alarm_functions = {
    gfs_ingest    = aws_lambda_function.ingest.function_name
    icon_ingest   = aws_lambda_function.ingest_icon.function_name
    publisher     = aws_lambda_function.publisher.function_name
    observability = aws_lambda_function.observability.function_name
  }

  observability_alarm_period_seconds = 900
}

resource "aws_sns_topic" "observability_alerts" {
  name = local.names.observability_alert_topic

  tags = merge(local.tags, {
    Name = local.names.observability_alert_topic
  })
}

resource "aws_sns_topic_subscription" "observability_alert_email" {
  topic_arn = aws_sns_topic.observability_alerts.arn
  protocol  = "email"
  endpoint  = var.observability_alert_email
}

data "aws_iam_policy_document" "observability_alert_topic" {
  statement {
    sid     = "AllowEventBridgePublish"
    effect  = "Allow"
    actions = ["sns:Publish"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    resources = [aws_sns_topic.observability_alerts.arn]

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values = [
        aws_cloudwatch_event_rule.batch_failed.arn,
        aws_cloudwatch_event_rule.batch_queue_blocked.arn
      ]
    }
  }

  statement {
    sid     = "AllowCloudWatchAlarmPublish"
    effect  = "Allow"
    actions = ["sns:Publish"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    resources = [aws_sns_topic.observability_alerts.arn]
  }
}

resource "aws_sns_topic_policy" "observability_alerts" {
  arn    = aws_sns_topic.observability_alerts.arn
  policy = data.aws_iam_policy_document.observability_alert_topic.json
}

resource "aws_iam_role" "observability_lambda" {
  name               = local.names.observability_role
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.observability_role
  })
}

data "aws_iam_policy_document" "observability_lambda" {
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
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [var.observability_metric_namespace]
    }
  }
}

resource "aws_iam_role_policy" "observability_lambda" {
  name   = local.names.observability_policy
  role   = aws_iam_role.observability_lambda.id
  policy = data.aws_iam_policy_document.observability_lambda.json
}

resource "aws_lambda_function" "observability" {
  function_name    = local.names.observability_lambda
  role             = aws_iam_role.observability_lambda.arn
  runtime          = "python3.12"
  handler          = "forecast_etl.aws.observability.handler"
  filename         = local.shared_lambda_zip_path
  source_code_hash = local.shared_lambda_zip_hash
  timeout          = var.observability_timeout_seconds
  memory_size      = 256

  environment {
    variables = {
      ARTIFACT_ROOT_URI                  = local.artifact_root_uri
      PIPELINE_CONFIG_URI                = local.pipeline_config_uri
      OBSERVABILITY_DATASETS             = join(",", var.publisher_datasets)
      OBSERVABILITY_METRIC_NAMESPACE     = var.observability_metric_namespace
      HEALTH_HISTORY_CYCLE_COUNT         = "4"
      HEALTH_STATUS_CYCLE_COUNT          = "4"
      HEALTH_STALE_FALLBACK_HOURS        = "9"
      HEALTH_RECENT_PROGRESS_HOURS       = "2"
      HEALTH_PUBLISH_GRACE_CUSHION_HOURS = "1"
      HEALTH_PUBLISH_GRACE_MIN_HOURS     = "3"
      HEALTH_PUBLISH_GRACE_MAX_HOURS     = "12"
    }
  }

  tags = merge(local.tags, {
    Name = local.names.observability_lambda
  })

  depends_on = [aws_s3_object.forecast_config, aws_s3_object.forecast_catalog]
}

resource "aws_cloudwatch_event_rule" "observability_schedule" {
  name                = local.names.observability_schedule
  description         = "Inspect ETL artifact health and emit observability metrics"
  schedule_expression = var.observability_schedule_expression

  tags = merge(local.tags, {
    Name = local.names.observability_schedule
  })
}

resource "aws_cloudwatch_event_target" "observability_schedule" {
  rule = aws_cloudwatch_event_rule.observability_schedule.name
  arn  = aws_lambda_function.observability.arn
}

resource "aws_lambda_permission" "allow_eventbridge_observability" {
  statement_id_prefix = "AllowExecutionFromEventBridgeObservability-"
  action              = "lambda:InvokeFunction"
  function_name       = aws_lambda_function.observability.function_name
  principal           = "events.amazonaws.com"
  source_arn          = aws_cloudwatch_event_rule.observability_schedule.arn

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.lambda_error_alarm_functions

  alarm_name          = "${local.name_prefix}-${each.key}-lambda-errors"
  alarm_description   = "weather-etl Lambda ${each.value} reported one or more errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.observability_alerts.arn]

  dimensions = {
    FunctionName = each.value
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "publisher_failed_candidates" {
  alarm_name          = "${local.name_prefix}-publisher-failed-candidates"
  alarm_description   = "weather-etl publisher caught one or more failed dataset-cycle candidates."
  namespace           = var.observability_metric_namespace
  metric_name         = "PublisherFailedCandidates"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.observability_alerts.arn]

  dimensions = {
    Component = "publisher"
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "observability_check_ok" {
  alarm_name          = "${local.name_prefix}-observability-check-not-ok"
  alarm_description   = "weather-etl observability checker reported a failed artifact-state check."
  namespace           = var.observability_metric_namespace
  metric_name         = "ObservabilityCheckOk"
  statistic           = "Minimum"
  period              = local.observability_alarm_period_seconds
  evaluation_periods  = var.observability_alarm_evaluation_periods
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.observability_alerts.arn]

  dimensions = {
    Component = "observability"
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "data_manifest_invalid" {
  alarm_name          = "${local.name_prefix}-data-manifest-invalid"
  alarm_description   = "weather-etl public data manifest is missing or malformed."
  namespace           = var.observability_metric_namespace
  metric_name         = "DataManifestValid"
  statistic           = "Minimum"
  period              = local.observability_alarm_period_seconds
  evaluation_periods  = var.observability_alarm_evaluation_periods
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.observability_alerts.arn]

  dimensions = {
    Component = "observability"
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "dataset_bad_state" {
  for_each = toset(var.publisher_datasets)

  alarm_name          = "${local.name_prefix}-${each.key}-dataset-bad-state"
  alarm_description   = "weather-etl dataset ${each.key} is stale, stalled, incomplete, or unavailable."
  namespace           = var.observability_metric_namespace
  metric_name         = "DatasetBadState"
  statistic           = "Maximum"
  period              = local.observability_alarm_period_seconds
  evaluation_periods  = var.observability_alarm_evaluation_periods
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.observability_alerts.arn]

  dimensions = {
    Component = "observability"
    Dataset   = each.key
  }

  tags = local.tags
}

resource "aws_cloudwatch_event_rule" "batch_failed" {
  name        = local.names.batch_failed_event_rule
  description = "Notify when weather ETL Batch jobs fail"

  event_pattern = jsonencode({
    source        = ["aws.batch"]
    "detail-type" = ["Batch Job State Change"]
    detail = {
      status   = ["FAILED"]
      jobQueue = [aws_batch_job_queue.etl.arn]
    }
  })

  tags = merge(local.tags, {
    Name = local.names.batch_failed_event_rule
  })
}

resource "aws_cloudwatch_event_target" "batch_failed" {
  rule = aws_cloudwatch_event_rule.batch_failed.name
  arn  = aws_sns_topic.observability_alerts.arn

  input_transformer {
    input_paths = {
      job_id        = "$.detail.jobId"
      job_name      = "$.detail.jobName"
      job_queue     = "$.detail.jobQueue"
      status_reason = "$.detail.statusReason"
    }
    input_template = "\"weather-etl Batch job failed: job_name=<job_name> job_id=<job_id> job_queue=<job_queue> status_reason=<status_reason>\""
  }
}

resource "aws_cloudwatch_event_rule" "batch_queue_blocked" {
  name        = local.names.batch_queue_blocked_event_rule
  description = "Notify when the weather ETL Batch queue is blocked"

  event_pattern = jsonencode({
    source        = ["aws.batch"]
    "detail-type" = ["Batch Job Queue Blocked"]
    detail = {
      jobQueue = [aws_batch_job_queue.etl.arn]
    }
  })

  tags = merge(local.tags, {
    Name = local.names.batch_queue_blocked_event_rule
  })
}

resource "aws_cloudwatch_event_target" "batch_queue_blocked" {
  rule = aws_cloudwatch_event_rule.batch_queue_blocked.name
  arn  = aws_sns_topic.observability_alerts.arn

  input_transformer {
    input_paths = {
      job_id        = "$.detail.jobId"
      job_name      = "$.detail.jobName"
      job_queue     = "$.detail.jobQueue"
      status_reason = "$.detail.statusReason"
    }
    input_template = "\"weather-etl Batch queue blocked: job_name=<job_name> job_id=<job_id> job_queue=<job_queue> status_reason=<status_reason>\""
  }
}
