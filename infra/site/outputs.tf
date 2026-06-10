output "sites" {
  description = "Static site outputs keyed by site identifier."
  value = {
    weather_map = module.static_site
  }
}

output "weather_map_cloudfront_logging" {
  description = "CloudFront access logging resources for weather.zmbm.dev."
  value = {
    athena_database = aws_glue_catalog_database.weather_map_logs.name
    athena_named_queries = [
      aws_athena_named_query.weather_map_daily_traffic_health.name,
      aws_athena_named_query.weather_map_top_paths.name,
      aws_athena_named_query.weather_map_recent_errors.name,
      aws_athena_named_query.weather_map_slow_paths.name,
    ]
    athena_table         = aws_glue_catalog_table.weather_map_cloudfront_access.name
    athena_workgroup     = aws_athena_workgroup.weather_map_logs.name
    dashboard_name       = aws_cloudwatch_dashboard.weather_map_cloudfront.dashboard_name
    delivery_destination = aws_cloudwatch_log_delivery_destination.weather_map_cloudfront_s3.name
    delivery_id          = aws_cloudwatch_log_delivery.weather_map_cloudfront_s3.id
    delivery_source      = aws_cloudwatch_log_delivery_source.weather_map_cloudfront.name
    log_bucket_name      = aws_s3_bucket.cloudfront_access_logs.bucket
    log_retention_days   = local.cloudfront_access_log_retention_days
    logged_distribution  = local.weather_map_distribution_id
  }
}
