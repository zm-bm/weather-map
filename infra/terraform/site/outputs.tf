output "sites" {
  description = "Static site outputs keyed by site identifier."
  value = {
    weather_map = module.static_site
  }
}
