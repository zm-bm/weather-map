# Forecast Layer Registry

Canonical registry of user-facing Weather Map forecast choices. Keep this
document in sync with `config/forecast_catalog.json`, plus the frontend catalog
adapters in `frontend/src/forecast-catalog/layer.ts` and
`frontend/src/forecast-catalog/particle.ts`.

This document defines the forecast choices the product presents to users:

- `layer_id`: selectable field layer
- `particle_layer_id`: selectable particle layer
- `group_id`: layer browsing group

It does **not** define ETL payload schemas, artifact encodings, or per-model
upstream field selection. It names source artifacts only to keep each frontend
recipe explicit.

Related docs:

- `terminology.md`: shared vocabulary
- `forecast-artifact-registry.md`: ETL artifact definitions
- `forecast-model-mapping.md`: how each model provides each canonical layer

## Scope And Rules

1. A layer is a user-facing weather concept, not a raw provider field or ETL payload.
2. A particle layer is a separate user-facing render choice, not a field layer.
3. A group is a browsing category for layers, not an artifact family.
4. Time semantics must be explicit: instantaneous, rate, fixed-window accumulation, or run total.
5. Source descriptions here stay at the frontend recipe level: direct artifact, derived artifact recipe, or composite recipe.
6. Model-specific availability, upstream field selection, and derivation details belong in `forecast-model-mapping.md`.
7. ETL payload kinds, components, and encodings belong in `forecast-artifact-registry.md`.

## Layer Groups

| Group id | Label | Default layer | Layers |
| --- | --- | --- | --- |
| `temperature` | Temperature | `temperature` | `temperature`, `apparent_temperature`, `dew_point`, `relative_humidity` |
| `wind_pressure` | Wind & Pressure | `wind_gust` | `wind_speed`, `wind_gust`, `air_pressure` |
| `precipitation` | Precipitation | `precipitation_rate` | `precipitation_rate`, `accumulated_precipitation`, `precipitable_water`, `snow_depth`, `freezing_level` |
| `clouds_visibility` | Clouds & Visibility | `cloud_cover` | `cloud_cover`, `low_cloud_cover`, `middle_cloud_cover`, `high_cloud_cover`, `visibility` |
| `radar_storms` | Radar & Storms | `cape` | `composite_reflectivity`, `cape`, `cin` |

In field-layer tables, `Display` is `units; display_range; palette_id;
unit_behavior/legend_scale`. These values mirror frontend display metadata, not
ETL encoding ranges.

## Field Layers

### Temperature

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | Temperature | direct scalar artifact `tmp_surface` | instantaneous | `C`; `-35..50`; `temperature.air.c.v1`; `temperature/temperature` | Near-surface screen temperature. |
| `apparent_temperature` | Apparent Temperature | direct scalar artifact `aptmp_surface` | instantaneous | `C`; `-35..50`; `temperature.air.c.v1`; `temperature/temperature` | Perceived near-surface temperature when available. |
| `dew_point` | Dew Point | direct scalar artifact `dewpoint_surface` | instantaneous | `C`; `-60..40`; `temperature.dewpoint.c.v1`; `temperature/temperature` | Near-surface dew point. |
| `relative_humidity` | Relative Humidity | direct scalar artifact `rh_surface` | instantaneous | `%`; `0..100`; `moisture.relative_humidity.percent.v1`; `percent/percent` | Near-surface relative humidity. |

### Wind & Pressure

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `wind_speed` | Wind Speed | derived field from vector artifact `wind10m_uv` using recipe `wind-speed` | instantaneous | `m/s`; `0..60`; `wind.gust.mps.v1`; `wind-speed/stop-based` | Computes `sqrt(u^2 + v^2)` in the frontend. |
| `wind_gust` | Wind Gust | direct scalar artifact `gust_surface` | instantaneous | `m/s`; `0..60`; `wind.gust.mps.v1`; `wind-speed/stop-based` | Near-surface gust speed. |
| `air_pressure` | Air Pressure | direct scalar artifact `prmsl_msl` | instantaneous | `Pa`; `98000..103500`; `pressure.msl.pa.v1`; `pressure/pressure` | Mean sea-level pressure. |

### Precipitation

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `precipitation_rate` | Precipitation Rate | direct scalar artifact `prate_surface` | rate or source-interval average rate, normalized to `mm/hr` | `mm/hr`; `0..30`; `precip.rate.mm_hr.v1`; `precip-rate/precip-rate` | Simple liquid-water-equivalent precipitation intensity. Type overlays are staged separately and are not rendered by this layer yet. |
| `accumulated_precipitation` | Accumulated Precipitation | direct scalar artifact `precip_total_surface` | run total unless a future artifact declares a fixed window | `mm`; `0..254`; `precip.total.mm.v1`; `precip-total/precip-total` | Not a rolling 1h/3h/24h accumulation layer. |
| `precipitable_water` | Precipitable Water | direct scalar artifact `precipitable_water` | instantaneous | `mm`; `0..80`; `atmosphere.precipitable_water.mm.v1`; `water-depth/stop-based` | Column-integrated water vapor expressed as liquid water depth. |
| `snow_depth` | Snow Depth | direct scalar artifact `snow_depth_surface` | instantaneous | `m`; `0..5`; `snow.depth.m.v1`; `snow-depth/stop-based` | Snow depth on the ground, not snowfall rate or new snow accumulation. |
| `freezing_level` | Freezing Level | direct scalar artifact `freezing_level` | instantaneous | `m`; `0..8000`; `atmosphere.freezing_level.m.v1`; `height/stop-based` | Height of the 0C isotherm. |

### Clouds & Visibility

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `cloud_cover` | Total Cloud Cover | direct scalar artifact `tcdc` | instantaneous | `%`; `0..100`; `cloud.cover.percent.v1`; `percent/percent` | Total cloud cover across the atmospheric column. |
| `low_cloud_cover` | Low Cloud Cover | direct scalar artifact `low_clouds` | instantaneous | `%`; `0..100`; `cloud.cover.percent.v1`; `percent/percent` | Low cloud layer cover. |
| `middle_cloud_cover` | Middle Cloud Cover | direct scalar artifact `medium_clouds` | instantaneous | `%`; `0..100`; `cloud.cover.percent.v1`; `percent/percent` | Middle cloud layer cover. |
| `high_cloud_cover` | High Cloud Cover | direct scalar artifact `high_clouds` | instantaneous | `%`; `0..100`; `cloud.cover.percent.v1`; `percent/percent` | High cloud layer cover. |
| `visibility` | Visibility | direct scalar artifact `visibility_surface` | instantaneous | `m`; `0..50000`; `atmosphere.visibility.m.v1`; `visibility/stop-based` | Horizontal surface visibility. |

### Radar & Storms

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `composite_reflectivity` | Simulated Radar | direct scalar artifact `refc_entire_atmosphere` | instantaneous | `dBZ`; `0..75`; `radar.reflectivity.dbz.v1`; `reflectivity/stop-based` | Forecast model composite reflectivity. This is simulated radar, not observed radar. |
| `cape` | CAPE Index | direct scalar artifact `cape_index` | instantaneous | `J/kg`; `0..5000`; `severe.cape.jkg.v1`; `energy-per-mass/stop-based` | Mixed-layer convective available potential energy. |
| `cin` | CIN | direct scalar artifact `cin_index` | instantaneous | `J/kg`; `0..500`; `severe.cin.jkg.v1`; `energy-per-mass/stop-based` | Mixed-layer convective inhibition displayed as positive cap-strength magnitude. |

## Particle Layers

| Particle layer id | Label | Source recipe | Time semantics | Notes |
| --- | --- | --- | --- | --- |
| `wind` | Wind | direct vector artifact `wind10m_uv` | instantaneous | Animated 10m wind particles from ordered `u` and `v` components. |

## Candidate Future Layers

This registry lists implemented catalog entries only. Track unimplemented
candidates in `forecast-catalog-candidates.md`, not here.
