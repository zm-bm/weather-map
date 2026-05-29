# Forecast Layer Registry

Canonical registry of user-facing Weather Map forecast choices. Keep this
document in sync with `config/forecast_catalog.json`, plus the frontend catalog
entries in `frontend/src/forecast/catalog/entries.ts`.

This document defines the forecast choices the product presents to users:

- `raster_layer_id`: selectable filled raster layer
- `particle_layer_id`: selectable particle layer
- `overlay_layer_id`: non-selectable layer-attached renderer overlay from
  `overlayLayers[]`
- `contour_layer_id`: non-selectable map-option contour renderer from
  `contourLayers[]`
- `raster_layer_group_id`: raster-layer browsing group

It does **not** define ETL payload schemas, artifact encodings, or per-model
upstream field selection. It names source artifacts only to keep each frontend
recipe explicit.

Related docs:

- `terminology.md`: shared vocabulary
- `forecast-artifact-registry.md`: ETL artifact definitions
- `forecast-model-mapping.md`: how each model provides each canonical layer

## Scope And Rules

1. A raster layer is a user-facing filled weather concept, not a raw provider field or ETL payload.
2. An overlay or contour layer is a renderer addition, not a selectable filled
   raster layer.
3. A particle layer is a separate user-facing render choice, not a raster layer.
4. A group is a browsing category for raster layers, not an artifact family.
5. Time semantics must be explicit: instantaneous, rate, fixed-window accumulation, or run total.
6. Source descriptions here stay at the frontend catalog level: source
   artifact, source bands, and optional overlay references.
7. Model-specific availability, upstream field selection, and derivation details belong in `forecast-model-mapping.md`.
8. ETL payload kinds, components, and encodings belong in `forecast-artifact-registry.md`.

## Raster Layer Groups

The first id in each `rasterLayerIds` list is the group default.

| Group id | Label | Raster layer ids |
| --- | --- | --- |
| `temperature` | Temperature | `temperature`, `apparent_temperature`, `dew_point`, `relative_humidity` |
| `wind_pressure` | Wind & Pressure | `wind_gust`, `wind_speed`, `air_pressure` |
| `precipitation` | Precipitation | `precipitation_rate`, `accumulated_precipitation`, `precipitable_water`, `snow_depth`, `freezing_level` |
| `clouds_visibility` | Clouds & Visibility | `cloud_layers`, `cloud_cover`, `visibility` |
| `radar_storms` | Radar & Storms | `cape`, `composite_reflectivity`, `cin` |

In raster-layer tables, `Display` is `units; display.range; source band
palette id(s); display.unitBehavior/display.legendScale`. These values mirror
frontend display metadata, not ETL encoding ranges.

## Display Behavior

1. Display ranges are renderer color clamps and default legend ranges. They do
   not define ETL encoded ranges or preserved overrange.
2. Probe labels show decoded physical values converted by each layer's unit
   behavior, unless the sampled value is nodata.
3. Nodata renders as no value rather than being clamped into the display range.
4. Raster color sampling is controlled by the global rendering setting. The
   default sampling mode is banded.

## Raster Layers

### Temperature

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | Temperature | raster source `tmp_surface` with `value` band | instantaneous | `C`; `-35..50`; `temperature.air.c.v1`; `temperature/temperature` | Near-surface screen temperature. |
| `apparent_temperature` | Apparent Temperature | raster source `aptmp_surface` with `value` band | instantaneous | `C`; `-35..50`; `temperature.air.c.v1`; `temperature/temperature` | Perceived near-surface temperature when available. |
| `dew_point` | Dew Point | raster source `dewpoint_surface` with `value` band | instantaneous | `C`; `-60..40`; `temperature.dewpoint.c.v1`; `temperature/temperature` | Near-surface dew point. |
| `relative_humidity` | Relative Humidity | raster source `rh_surface` with `value` band | instantaneous | `%`; `0..100`; `moisture.relative_humidity.percent.v1`; `percent/percent` | Near-surface relative humidity. |

### Wind & Pressure

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `wind_speed` | Wind Speed | raster source `wind10m_uv` with `u` and `v` bands | instantaneous | `m/s`; `0..60`; `wind.gust.mps.v1`; `wind-speed/stop-based` | The raster renderer and probes compute `sqrt(u^2 + v^2)` from the loaded bands. |
| `wind_gust` | Wind Gust | raster source `gust_surface` with `value` band | instantaneous | `m/s`; `0..60`; `wind.gust.mps.v1`; `wind-speed/stop-based` | Near-surface gust speed. |
| `air_pressure` | Air Pressure | raster source `prmsl_msl` with `value` band | instantaneous | `Pa`; `98000..103600`; `pressure.msl.pa.v1`; `pressure/pressure` | Mean sea-level pressure. |

### Precipitation

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `precipitation_rate` | Precipitation Rate | raster source `prate_surface` with `value` band; optional overlay layer `precipitation_type` | rate or source-interval average rate, normalized to `mm/hr` | `mm/hr`; `0..30`; `precip.rate.mm_hr.v1`; `precip-rate/precip-rate` | Liquid-water-equivalent precipitation intensity with automatic snowflake / pale alternating snowflake-ice-dash winter-mix glyph overlays that fade during map zoom when `precip_type_surface` is available. |
| `accumulated_precipitation` | Run-Total Precipitation | raster source `precip_total_surface` with `value` band | run total since model reference time | `mm`; `0..254`; `precip.total.mm.v1`; `precip-total/precip-total` | Not a rolling 1h/3h/24h accumulation layer. |
| `precipitable_water` | Precipitable Water | raster source `precipitable_water` with `value` band | instantaneous | `mm`; `0..80`; `atmosphere.precipitable_water.mm.v1`; `water-depth/stop-based` | Column-integrated water vapor expressed as liquid water depth. |
| `snow_depth` | Snow Depth | raster source `snow_depth_surface` with `value` band | instantaneous | `m`; `0..3`; `snow.depth.m.v1`; `snow-depth/snow-depth` | Snow depth on the ground, not snowfall rate or new snow accumulation. |
| `freezing_level` | Freezing Level | raster source `freezing_level` with `value` band | instantaneous | `m`; `0..8000`; `atmosphere.freezing_level.m.v1`; `height/stop-based` | Height of the 0C isotherm. |

`precipitation_rate` answers how much liquid-water-equivalent precipitation is
falling. When the optional `precip_type_surface` artifact is available, a
separate overlay pass answers what frozen type is present: `snow_frac` renders a
snowflake lattice, `mix_frac` renders alternating snowflake / diagonal ice-dash
glyphs, and rain remains the base intensity ramp with no type glyph. The
overlay uses soft masks equivalent to `smoothstep(0.35, 0.65, fraction)`, fades
during active zoom, and keeps screen-sized spacing from `12px` at z2 to `30px`
at z6.

### Clouds & Visibility

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `cloud_layers` | Cloud Layers | raster source `cloud_layers` with `low`, `middle`, `high` bands | instantaneous | `%`; `0..100`; `cloud.layers.low.v1`, `cloud.layers.middle.v1`, `cloud.layers.high.v1`; `percent/percent` | The raster renderer uses low, middle, and high cloud cover as grayscale cloud-structure inputs, with derived composite coverage for opacity and probe labels. |
| `cloud_cover` | Total/Sky Cover | raster source `tcdc` with `value` band | instantaneous | `%`; `0..100`; `cloud.cover.percent.v1`; `percent/percent` | Total cloud cover across the atmospheric column. |
| `visibility` | Visibility | raster source `visibility_surface` with `value` band | instantaneous | `m`; `0..50000`; `atmosphere.visibility.m.v1`; `visibility/stop-based` | Horizontal surface visibility. |

### Radar & Storms

| Layer id | Label | Source recipe | Time semantics | Display | Notes |
| --- | --- | --- | --- | --- | --- |
| `composite_reflectivity` | Simulated Radar | raster source `refc_entire_atmosphere` with `value` band | instantaneous | `dBZ`; `0..75`; `radar.reflectivity.dbz.v1`; `reflectivity/stop-based` | Forecast model composite reflectivity. This is simulated radar, not observed radar. |
| `cape` | CAPE Index | raster source `cape_index` with `value` band | instantaneous | `J/kg`; `0..5000`; `severe.cape.jkg.v1`; `energy-per-mass/stop-based` | Mixed-layer convective available potential energy. |
| `cin` | CIN | raster source `cin_index` with `value` band | instantaneous | `J/kg`; `0..500`; `severe.cin.jkg.v1`; `energy-per-mass/stop-based` | Mixed-layer convective inhibition displayed as positive cap-strength magnitude. |

## Particle Layers

| Particle layer id | Label | Source recipe | Time semantics | Notes |
| --- | --- | --- | --- | --- |
| `wind` | Wind | source `wind10m_uv` with `u` and `v` bands | instantaneous | Animated 10m wind particles from ordered `u` and `v` components. |

## Overlay Layers

| Overlay id | Label | Source recipe | Time semantics | Renderer | Notes |
| --- | --- | --- | --- | --- | --- |
| `precipitation_type` | Precipitation Type Pattern | optional source `precip_type_surface` with `snow_frac` and `mix_frac` bands | source-interval derived overlay | `overlay` | Automatic optional overlay referenced by `precipitation_rate`; renders snowflake and winter-mix glyph patterns when available. |

## Contour Layers

| Contour layer id | Label | Source recipe | Time semantics | Renderer | Notes |
| --- | --- | --- | --- | --- | --- |
| `pressure_contours` | Pressure Contours | source `prmsl_msl` with `value` band | instantaneous | `contour` | Map-option-controlled GPU-rendered `400 Pa` / `4 hPa` mean-sea-level pressure contours from a lightly smoothed pressure surface. ICON uses its downsampled `0.25` pressure artifact. V1 draws unlabeled solid white lines with a faint separation halo. |

## Candidate Future Layers

This registry lists implemented catalog entries only. Track unimplemented
layer, model, and external-source ideas in `roadmap.md`, not here.
