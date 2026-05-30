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
| `temperature` | Temperature | `temperature`, `apparent_temperature` |
| `humidity` | Humidity | `dew_point`, `relative_humidity` |
| `wind_pressure` | Wind & Pressure | `wind_gust`, `wind_speed`, `air_pressure` |
| `precipitation` | Precipitation | `precipitation_rate`, `accumulated_precipitation`, `precipitable_water`, `snow_depth`, `freezing_level` |
| `clouds_visibility` | Clouds & Visibility | `cloud_layers`, `cloud_cover`, `visibility` |
| `radar_storms` | Radar & Storms | `cape`, `composite_reflectivity`, `cin` |

In raster-layer tables, `Display` is the `displayProfile` from the frontend
display module. The display profile owns the label, display range, unit
options, legend labels, and palette colors. Catalog source bands are load
metadata only.

## Display Behavior

1. Display ranges are renderer color clamps. Legend labels live in
   `forecast/display` profiles; they determine the visible legend gradient and
   do not define ETL encoded ranges or preserved overrange.
2. Probe labels show decoded physical values converted by each layer's display
   profile unit options, unless the sampled value is nodata.
3. Nodata renders as no value rather than being clamped into the display range.
4. Raster color sampling is controlled by the global rendering setting. The
   default sampling mode is banded.

## Raster Layers

### Temperature

| Layer id | Label | Source recipe | Time semantics | Display profile | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | Temperature | raster source `tmp_surface` with `value` band | instantaneous | `temperature` | Near-surface screen temperature. |
| `apparent_temperature` | Apparent Temperature | raster source `aptmp_surface` with `value` band | instantaneous | `apparent-temperature` | Perceived near-surface temperature when available. |

### Humidity

| Layer id | Label | Source recipe | Time semantics | Display profile | Notes |
| --- | --- | --- | --- | --- | --- |
| `dew_point` | Dew Point | raster source `dewpoint_surface` with `value` band | instantaneous | `dew-point` | Near-surface dew point. |
| `relative_humidity` | Relative Humidity | raster source `rh_surface` with `value` band | instantaneous | `relative-humidity` | Near-surface relative humidity. |

### Wind & Pressure

| Layer id | Label | Source recipe | Time semantics | Display profile | Notes |
| --- | --- | --- | --- | --- | --- |
| `wind_speed` | Wind Speed | raster source `wind10m_uv` with `u` and `v` bands | instantaneous | `wind-speed` | The raster renderer and probes compute `sqrt(u^2 + v^2)` from the loaded bands. |
| `wind_gust` | Wind Gust | raster source `gust_surface` with `value` band | instantaneous | `wind-gust` | Near-surface gust speed. |
| `air_pressure` | Air Pressure | raster source `prmsl_msl` with `value` band | instantaneous | `air-pressure` | Mean sea-level pressure. |

### Precipitation

| Layer id | Label | Source recipe | Time semantics | Display profile | Notes |
| --- | --- | --- | --- | --- | --- |
| `precipitation_rate` | Precipitation Rate | raster source `prate_surface` with `value` band; optional overlay layer `precipitation_type` | rate or source-interval average rate, normalized to `mm/hr` | `precipitation-rate` | Liquid-water-equivalent precipitation intensity with automatic snowflake / pale alternating snowflake-ice-dash winter-mix glyph overlays that fade during map zoom when `precip_type_surface` is available. |
| `accumulated_precipitation` | Run-Total Precipitation | raster source `precip_total_surface` with `value` band | run total since model reference time | `accumulated-precipitation` | Not a rolling 1h/3h/24h accumulation layer. |
| `precipitable_water` | Precipitable Water | raster source `precipitable_water` with `value` band | instantaneous | `precipitable-water` | Column-integrated water vapor expressed as liquid water depth. |
| `snow_depth` | Snow Depth | raster source `snow_depth_surface` with `value` band | instantaneous | `snow-depth` | Snow depth on the ground, not snowfall rate or new snow accumulation. |
| `freezing_level` | Freezing Level | raster source `freezing_level` with `value` band | instantaneous | `freezing-level` | Height of the 0C isotherm. |

`precipitation_rate` answers how much liquid-water-equivalent precipitation is
falling. When the optional `precip_type_surface` artifact is available, a
separate overlay pass answers what frozen type is present: `snow_frac` renders a
snowflake lattice, `mix_frac` renders alternating snowflake / diagonal ice-dash
glyphs, and rain remains the base intensity ramp with no type glyph. The
overlay uses soft masks equivalent to `smoothstep(0.35, 0.65, fraction)`, fades
during active zoom, and keeps screen-sized spacing from `12px` at z2 to `30px`
at z6.

### Clouds & Visibility

| Layer id | Label | Source recipe | Time semantics | Display profile | Notes |
| --- | --- | --- | --- | --- | --- |
| `cloud_layers` | Cloud Layers | raster source `cloud_layers` with `low`, `middle`, `high` bands | instantaneous | `cloud-layers` | The raster renderer uses low, middle, and high cloud cover as grayscale cloud-structure inputs, with derived composite coverage for opacity and probe labels. |
| `cloud_cover` | Total/Sky Cover | raster source `tcdc` with `value` band | instantaneous | `cloud-cover` | Total cloud cover across the atmospheric column. |
| `visibility` | Visibility | raster source `visibility_surface` with `value` band | instantaneous | `visibility` | Horizontal surface visibility. |

### Radar & Storms

| Layer id | Label | Source recipe | Time semantics | Display profile | Notes |
| --- | --- | --- | --- | --- | --- |
| `composite_reflectivity` | Simulated Radar | raster source `refc_entire_atmosphere` with `value` band | instantaneous | `composite-reflectivity` | Forecast model composite reflectivity. This is simulated radar, not observed radar. |
| `cape` | CAPE Index | raster source `cape_index` with `value` band | instantaneous | `cape` | Mixed-layer convective available potential energy. |
| `cin` | CIN | raster source `cin_index` with `value` band | instantaneous | `cin` | Mixed-layer convective inhibition displayed as positive cap-strength magnitude. |

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
