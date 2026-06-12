locals {
  lambda_error_alarm_functions = {
    gfs_ingest  = aws_lambda_function.ingest.function_name
    icon_ingest = aws_lambda_function.ingest_icon.function_name
    mrms_ingest = aws_lambda_function.ingest_mrms.function_name
    publisher   = aws_lambda_function.publisher.function_name
  }
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
