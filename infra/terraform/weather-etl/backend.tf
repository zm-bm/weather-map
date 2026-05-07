terraform {
  backend "s3" {
    bucket       = "zmbm-tf-state-bucket"
    key          = "weather-etl.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
