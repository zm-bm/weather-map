terraform {
  backend "s3" {
    bucket       = "zmbm-tf-state-bucket"
    key          = "weather-map/site.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    # dynamodb_table = "terraform-locks"
  }
}
