locals {
  state_bucket = "zmbm-tf-state-bucket"
  state_region = "us-east-1"
  state_keys = {
    weather_etl = "weather-etl.tfstate"
  }

  weather_map_artifact_origin = {
    bucket_name = data.terraform_remote_state.weather_etl.outputs.artifacts_bucket_name
    path_patterns = tolist([
      "/manifests/latest.json",
      "/manifests/*",
      "/runs/*/fields/*",
      "/glyphs/*",
      "/pmtiles/*",
      "/radio/*",
    ])
    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 86400
  }
  weather_map_api_app_header_value = "weather-map-api"
  backend_lambda_zip_path          = abspath("${path.root}/../../../backend/dist/weather-map-backend-lambda.zip")
}

data "terraform_remote_state" "weather_etl" {
  backend = "s3"
  config = {
    bucket = local.state_bucket
    key    = local.state_keys.weather_etl
    region = local.state_region
  }
}

module "static_site" {
  source = "git::ssh://git@github.com/zm-bm/infra.git//modules/static-site?ref=e3a8f4cce5d826dc32f0104898d6c09d3189865d"

  site_name            = "weather-map"
  domain               = "weather.zmbm.dev"
  alt_domains          = []
  zone_name            = "zmbm.dev"
  cert_domain          = "zmbm.dev"
  bucket_name          = "weather-map-bucket"
  github_repo          = "zm-bm/weather-map"
  github_refs          = ["refs/heads/main", "refs/tags/v*"]
  price_class          = "PriceClass_100"
  enabled              = true
  www_redirect_domain  = ""
  response_headers     = {}
  spa_fallback_enabled = true
  artifact_origin      = local.weather_map_artifact_origin
  api_proxy = {
    origin_domain    = data.aws_lb.edge.dns_name
    app_header_value = local.weather_map_api_app_header_value
    path_pattern     = "/api/*"
  }
  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
  }
}
