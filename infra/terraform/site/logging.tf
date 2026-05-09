data "aws_caller_identity" "current" {}

locals {
  cloudfront_access_log_bucket_name    = "zmbm-cloudfront-access-logs-${data.aws_caller_identity.current.account_id}"
  cloudfront_access_log_retention_days = 30
  weather_map_distribution_id          = module.static_site.distribution_id
  weather_map_distribution_arn         = module.static_site.distribution_arn

  cloudfront_access_log_record_fields = [
    "date",
    "time",
    "x-edge-location",
    "sc-bytes",
    "c-ip",
    "cs-method",
    "cs(Host)",
    "cs-uri-stem",
    "sc-status",
    "cs(Referer)",
    "cs(User-Agent)",
    "x-edge-result-type",
    "x-edge-request-id",
    "x-host-header",
    "cs-protocol",
    "cs-bytes",
    "time-taken",
    "x-edge-response-result-type",
    "cs-protocol-version",
    "time-to-first-byte",
    "x-edge-detailed-result-type",
    "sc-content-type",
    "sc-content-len",
    "sc-range-start",
    "sc-range-end",
    "c-country",
    "cache-behavior-path-pattern",
  ]

  cloudfront_access_log_table_columns = [
    "date",
    "time",
    "x_edge_location",
    "sc_bytes",
    "c_ip",
    "cs_method",
    "cs_host",
    "cs_uri_stem",
    "sc_status",
    "cs_referer",
    "cs_user_agent",
    "x_edge_result_type",
    "x_edge_request_id",
    "x_host_header",
    "cs_protocol",
    "cs_bytes",
    "time_taken",
    "x_edge_response_result_type",
    "cs_protocol_version",
    "time_to_first_byte",
    "x_edge_detailed_result_type",
    "sc_content_type",
    "sc_content_len",
    "sc_range_start",
    "sc_range_end",
    "c_country",
    "cache_behavior_path_pattern",
  ]

  cloudfront_access_log_s3_root = "s3://${aws_s3_bucket.cloudfront_access_logs.bucket}/AWSLogs/aws-account-id=${data.aws_caller_identity.current.account_id}/CloudFront/"
}

resource "aws_s3_bucket" "cloudfront_access_logs" {
  bucket = local.cloudfront_access_log_bucket_name

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
    Name      = "cloudfront-access-logs"
  }
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  rule {
    blocked_encryption_types = ["SSE-C"]

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id

  rule {
    id     = "expire-cloudfront-access-logs"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = local.cloudfront_access_log_retention_days
    }
  }
}

data "aws_iam_policy_document" "cloudfront_access_logs" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.cloudfront_access_logs.arn,
      "${aws_s3_bucket.cloudfront_access_logs.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "AWSLogDeliveryAclCheck"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    actions = [
      "s3:GetBucketAcl",
      "s3:ListBucket",
    ]

    resources = [aws_s3_bucket.cloudfront_access_logs.arn]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }

  statement {
    sid    = "AWSLogDeliveryWrite"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    actions = ["s3:PutObject"]

    resources = ["${aws_s3_bucket.cloudfront_access_logs.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudfront_access_logs" {
  bucket = aws_s3_bucket.cloudfront_access_logs.id
  policy = data.aws_iam_policy_document.cloudfront_access_logs.json

  depends_on = [
    aws_s3_bucket_ownership_controls.cloudfront_access_logs,
    aws_s3_bucket_public_access_block.cloudfront_access_logs,
  ]
}

resource "aws_cloudwatch_log_delivery_source" "weather_map_cloudfront" {
  name         = "weather-map-cloudfront-access"
  log_type     = "ACCESS_LOGS"
  resource_arn = local.weather_map_distribution_arn

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
  }
}

resource "aws_cloudwatch_log_delivery_destination" "weather_map_cloudfront_s3" {
  name          = "weather-map-cloudfront-s3"
  output_format = "parquet"

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.cloudfront_access_logs.arn
  }

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
  }
}

resource "aws_cloudwatch_log_delivery" "weather_map_cloudfront_s3" {
  delivery_source_name     = aws_cloudwatch_log_delivery_source.weather_map_cloudfront.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.weather_map_cloudfront_s3.arn
  record_fields            = local.cloudfront_access_log_record_fields

  s3_delivery_configuration = [{
    enable_hive_compatible_path = true
    suffix_path                 = "{distributionid}/{yyyy}/{MM}/{dd}/{HH}"
  }]

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
  }

  depends_on = [aws_s3_bucket_policy.cloudfront_access_logs]
}

resource "aws_glue_catalog_database" "weather_map_logs" {
  name        = "weather_map_logs"
  description = "CloudFront access logs for weather.zmbm.dev"

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
  }
}

resource "aws_glue_catalog_table" "weather_map_cloudfront_access" {
  name          = "cloudfront_access_logs"
  database_name = aws_glue_catalog_database.weather_map_logs.name
  table_type    = "EXTERNAL_TABLE"
  description   = "Projected Parquet CloudFront access logs for weather.zmbm.dev"

  parameters = {
    EXTERNAL                                   = "TRUE"
    classification                             = "parquet"
    "projection.enabled"                       = "true"
    "projection.distributionid.type"           = "enum"
    "projection.distributionid.values"         = local.weather_map_distribution_id
    "projection.year.type"                     = "integer"
    "projection.year.range"                    = "2026,2036"
    "projection.year.digits"                   = "4"
    "projection.month.type"                    = "integer"
    "projection.month.range"                   = "1,12"
    "projection.month.digits"                  = "2"
    "projection.day.type"                      = "integer"
    "projection.day.range"                     = "1,31"
    "projection.day.digits"                    = "2"
    "projection.hour.type"                     = "integer"
    "projection.hour.range"                    = "0,23"
    "projection.hour.digits"                   = "2"
    "storage.location.template"                = "${local.cloudfront_access_log_s3_root}distributionid=$${distributionid}/year=$${year}/month=$${month}/day=$${day}/hour=$${hour}/"
    "parquet.compression"                      = "SNAPPY"
    "skip.header.line.count"                   = "0"
    "has_encrypted_data"                       = "false"
    "cloudfront.log.delivery.destination"      = aws_cloudwatch_log_delivery_destination.weather_map_cloudfront_s3.name
    "cloudfront.log.delivery.source"           = aws_cloudwatch_log_delivery_source.weather_map_cloudfront.name
    "cloudfront.log.delivery.destination_type" = "S3"
  }

  partition_keys {
    name = "distributionid"
    type = "string"
  }

  partition_keys {
    name = "year"
    type = "int"
  }

  partition_keys {
    name = "month"
    type = "int"
  }

  partition_keys {
    name = "day"
    type = "int"
  }

  partition_keys {
    name = "hour"
    type = "int"
  }

  storage_descriptor {
    location      = local.cloudfront_access_log_s3_root
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.cloudfront_access_log_table_columns

      content {
        name = columns.value
        type = "string"
      }
    }
  }
}

resource "aws_athena_workgroup" "weather_map_logs" {
  name        = "weather-map-logs"
  description = "Athena workgroup for weather.zmbm.dev CloudFront access log queries."
  state       = "ENABLED"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    bytes_scanned_cutoff_per_query     = 1073741824

    result_configuration {
      output_location = "s3://${aws_s3_bucket.cloudfront_access_logs.bucket}/athena-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
  }
}

resource "aws_athena_named_query" "weather_map_daily_traffic_health" {
  name        = "weather-map-daily-traffic-health"
  database    = aws_glue_catalog_database.weather_map_logs.name
  description = "Daily CloudFront traffic, errors, cache behavior, and latency for weather.zmbm.dev over retained logs."
  workgroup   = aws_athena_workgroup.weather_map_logs.name

  query = <<-SQL
    WITH requests AS (
      SELECT
        "date" AS request_date,
        c_ip AS client_ip,
        cs_user_agent AS user_agent,
        COALESCE(TRY_CAST(sc_bytes AS BIGINT), 0) AS response_bytes,
        TRY_CAST(sc_status AS INTEGER) AS status_code,
        x_edge_result_type AS result_type,
        TRY_CAST(time_to_first_byte AS DOUBLE) AS time_to_first_byte_seconds
      FROM "${aws_glue_catalog_database.weather_map_logs.name}"."${aws_glue_catalog_table.weather_map_cloudfront_access.name}"
      WHERE (
          "year" > year(current_date - interval '30' day)
          OR ("year" = year(current_date - interval '30' day) AND "month" > month(current_date - interval '30' day))
          OR ("year" = year(current_date - interval '30' day) AND "month" = month(current_date - interval '30' day) AND "day" >= day(current_date - interval '30' day))
        )
        AND (
          "year" < year(current_date)
          OR ("year" = year(current_date) AND "month" < month(current_date))
          OR ("year" = year(current_date) AND "month" = month(current_date) AND "day" <= day(current_date))
        )
    )
    SELECT
      request_date,
      approx_distinct(concat(client_ip, '|', user_agent)) AS approximate_visitors,
      count(*) AS requests,
      sum(response_bytes) AS bytes_downloaded,
      round(
        100.0 * sum(CASE WHEN result_type IN ('Hit', 'RefreshHit') THEN 1 ELSE 0 END)
        / NULLIF(sum(CASE WHEN result_type IN ('Hit', 'RefreshHit', 'Miss') THEN 1 ELSE 0 END), 0),
        2
      ) AS cache_hit_rate_pct,
      round(1000.0 * approx_percentile(time_to_first_byte_seconds, 0.50), 1) AS p50_ttfb_ms,
      round(1000.0 * approx_percentile(time_to_first_byte_seconds, 0.95), 1) AS p95_ttfb_ms,
      round(100.0 * sum(CASE WHEN status_code BETWEEN 400 AND 499 THEN 1 ELSE 0 END) / NULLIF(count(*), 0), 2) AS four_xx_rate_pct,
      round(100.0 * sum(CASE WHEN status_code BETWEEN 500 AND 599 THEN 1 ELSE 0 END) / NULLIF(count(*), 0), 2) AS five_xx_rate_pct,
      round(100.0 * sum(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / NULLIF(count(*), 0), 2) AS total_error_rate_pct,
      sum(CASE WHEN status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS status_2xx,
      sum(CASE WHEN status_code BETWEEN 300 AND 399 THEN 1 ELSE 0 END) AS status_3xx,
      sum(CASE WHEN status_code BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS status_4xx,
      sum(CASE WHEN status_code BETWEEN 500 AND 599 THEN 1 ELSE 0 END) AS status_5xx
    FROM requests
    GROUP BY request_date
    ORDER BY request_date DESC;
  SQL
}

resource "aws_athena_named_query" "weather_map_top_paths" {
  name        = "weather-map-top-paths-30d"
  database    = aws_glue_catalog_database.weather_map_logs.name
  description = "Most requested CloudFront paths for weather.zmbm.dev, with bytes, cache behavior, errors, and latency."
  workgroup   = aws_athena_workgroup.weather_map_logs.name

  query = <<-SQL
    WITH requests AS (
      SELECT
        cs_uri_stem AS path,
        COALESCE(TRY_CAST(sc_bytes AS BIGINT), 0) AS response_bytes,
        TRY_CAST(sc_status AS INTEGER) AS status_code,
        x_edge_result_type AS result_type,
        TRY_CAST(time_to_first_byte AS DOUBLE) AS time_to_first_byte_seconds
      FROM "${aws_glue_catalog_database.weather_map_logs.name}"."${aws_glue_catalog_table.weather_map_cloudfront_access.name}"
      WHERE (
          "year" > year(current_date - interval '30' day)
          OR ("year" = year(current_date - interval '30' day) AND "month" > month(current_date - interval '30' day))
          OR ("year" = year(current_date - interval '30' day) AND "month" = month(current_date - interval '30' day) AND "day" >= day(current_date - interval '30' day))
        )
        AND (
          "year" < year(current_date)
          OR ("year" = year(current_date) AND "month" < month(current_date))
          OR ("year" = year(current_date) AND "month" = month(current_date) AND "day" <= day(current_date))
        )
    )
    SELECT
      path,
      count(*) AS requests,
      sum(response_bytes) AS bytes_downloaded,
      round(CAST(sum(response_bytes) AS DOUBLE) / NULLIF(CAST(count(*) AS DOUBLE), 0), 2) AS avg_bytes_per_request,
      round(
        100.0 * sum(CASE WHEN result_type IN ('Hit', 'RefreshHit') THEN 1 ELSE 0 END)
        / NULLIF(sum(CASE WHEN result_type IN ('Hit', 'RefreshHit', 'Miss') THEN 1 ELSE 0 END), 0),
        2
      ) AS cache_hit_rate_pct,
      round(1000.0 * approx_percentile(time_to_first_byte_seconds, 0.95), 1) AS p95_ttfb_ms,
      sum(CASE WHEN status_code BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS status_4xx,
      sum(CASE WHEN status_code BETWEEN 500 AND 599 THEN 1 ELSE 0 END) AS status_5xx
    FROM requests
    WHERE path IS NOT NULL
    GROUP BY path
    ORDER BY requests DESC, bytes_downloaded DESC
    LIMIT 100;
  SQL
}

resource "aws_athena_named_query" "weather_map_recent_errors" {
  name        = "weather-map-recent-errors-24h"
  database    = aws_glue_catalog_database.weather_map_logs.name
  description = "Recent 4xx and 5xx CloudFront requests for debugging broken paths, access issues, and edge failures."
  workgroup   = aws_athena_workgroup.weather_map_logs.name

  query = <<-SQL
    WITH requests AS (
      SELECT
        from_iso8601_timestamp(concat("date", 'T', "time", 'Z')) AS request_time_utc,
        TRY_CAST(sc_status AS INTEGER) AS status_code,
        cs_method AS method,
        cs_uri_stem AS path,
        x_edge_result_type AS result_type,
        x_edge_detailed_result_type AS detailed_result_type,
        c_country AS country,
        x_edge_location AS edge_location,
        cs_referer AS referer,
        cs_user_agent AS user_agent,
        x_edge_request_id AS request_id,
        TRY_CAST(time_to_first_byte AS DOUBLE) AS time_to_first_byte_seconds,
        TRY_CAST(time_taken AS DOUBLE) AS time_taken_seconds
      FROM "${aws_glue_catalog_database.weather_map_logs.name}"."${aws_glue_catalog_table.weather_map_cloudfront_access.name}"
      WHERE (
          ("year" = year(current_date) AND "month" = month(current_date) AND "day" = day(current_date))
          OR ("year" = year(current_date - interval '1' day) AND "month" = month(current_date - interval '1' day) AND "day" = day(current_date - interval '1' day))
        )
    )
    SELECT
      request_time_utc,
      status_code,
      method,
      path,
      result_type,
      detailed_result_type,
      country,
      edge_location,
      round(1000.0 * time_to_first_byte_seconds, 1) AS ttfb_ms,
      round(1000.0 * time_taken_seconds, 1) AS time_taken_ms,
      referer,
      user_agent,
      request_id
    FROM requests
    WHERE status_code >= 400
      AND request_time_utc >= current_timestamp - interval '24' hour
    ORDER BY request_time_utc DESC
    LIMIT 200;
  SQL
}

resource "aws_athena_named_query" "weather_map_slow_paths" {
  name        = "weather-map-slow-paths-24h"
  database    = aws_glue_catalog_database.weather_map_logs.name
  description = "Slowest CloudFront paths by p95 time to first byte over the last 24 hours."
  workgroup   = aws_athena_workgroup.weather_map_logs.name

  query = <<-SQL
    WITH requests AS (
      SELECT
        from_iso8601_timestamp(concat("date", 'T', "time", 'Z')) AS request_time_utc,
        cs_uri_stem AS path,
        TRY_CAST(sc_status AS INTEGER) AS status_code,
        TRY_CAST(time_to_first_byte AS DOUBLE) AS time_to_first_byte_seconds,
        TRY_CAST(time_taken AS DOUBLE) AS time_taken_seconds,
        COALESCE(TRY_CAST(sc_bytes AS BIGINT), 0) AS response_bytes
      FROM "${aws_glue_catalog_database.weather_map_logs.name}"."${aws_glue_catalog_table.weather_map_cloudfront_access.name}"
      WHERE (
          ("year" = year(current_date) AND "month" = month(current_date) AND "day" = day(current_date))
          OR ("year" = year(current_date - interval '1' day) AND "month" = month(current_date - interval '1' day) AND "day" = day(current_date - interval '1' day))
        )
    )
    SELECT
      path,
      count(*) AS requests,
      round(1000.0 * avg(time_to_first_byte_seconds), 1) AS avg_ttfb_ms,
      round(1000.0 * approx_percentile(time_to_first_byte_seconds, 0.95), 1) AS p95_ttfb_ms,
      round(1000.0 * max(time_taken_seconds), 1) AS max_time_taken_ms,
      sum(response_bytes) AS bytes_downloaded,
      sum(CASE WHEN status_code BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS status_4xx,
      sum(CASE WHEN status_code BETWEEN 500 AND 599 THEN 1 ELSE 0 END) AS status_5xx
    FROM requests
    WHERE path IS NOT NULL
      AND request_time_utc >= current_timestamp - interval '24' hour
      AND time_to_first_byte_seconds IS NOT NULL
    GROUP BY path
    ORDER BY p95_ttfb_ms DESC, requests DESC
    LIMIT 50;
  SQL
}

resource "aws_cloudwatch_dashboard" "weather_map_cloudfront" {
  dashboard_name = "weather-map-cloudfront"

  dashboard_body = jsonencode({
    start = "-P7D"
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Weather Map Requests"
          region = "us-east-1"
          view   = "timeSeries"
          period = 3600
          stat   = "Sum"
          yAxis = {
            left = {
              label = "Requests"
              min   = 0
            }
          }
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", local.weather_map_distribution_id, "Region", "Global", { label = "Requests" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Weather Map Bytes Downloaded"
          region = "us-east-1"
          view   = "timeSeries"
          period = 3600
          stat   = "Sum"
          yAxis = {
            left = {
              label = "Bytes"
              min   = 0
            }
          }
          metrics = [
            ["AWS/CloudFront", "BytesDownloaded", "DistributionId", local.weather_map_distribution_id, "Region", "Global", { label = "Bytes downloaded" }],
            [".", "BytesUploaded", ".", ".", ".", ".", { label = "Bytes uploaded" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Weather Map Error Rates"
          region = "us-east-1"
          view   = "timeSeries"
          period = 3600
          stat   = "Average"
          yAxis = {
            left = {
              label = "Percent"
              min   = 0
              max   = 100
            }
          }
          metrics = [
            ["AWS/CloudFront", "4xxErrorRate", "DistributionId", local.weather_map_distribution_id, "Region", "Global", { label = "4xx error rate" }],
            [".", "5xxErrorRate", ".", ".", ".", ".", { label = "5xx error rate" }],
            [".", "TotalErrorRate", ".", ".", ".", ".", { label = "Total error rate" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Weather Map Estimated Error Requests"
          region = "us-east-1"
          view   = "timeSeries"
          period = 3600
          yAxis = {
            left = {
              label = "Requests"
              min   = 0
            }
          }
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", local.weather_map_distribution_id, "Region", "Global", { id = "m1", stat = "Sum", visible = false }],
            [".", "4xxErrorRate", ".", ".", ".", ".", { id = "m2", stat = "Average", visible = false }],
            [".", "5xxErrorRate", ".", ".", ".", ".", { id = "m3", stat = "Average", visible = false }],
            [{ expression = "m1*m2/100", label = "Estimated 4xx requests", id = "e1", region = "us-east-1" }],
            [{ expression = "m1*m3/100", label = "Estimated 5xx requests", id = "e2", region = "us-east-1" }]
          ]
        }
      }
    ]
  })
}
