# Forecast Model Mapping

Concrete mapping from forecast models to Weather Map frontend catalog choices.
Keep this document in sync with:

- `docs/forecast-layer-registry.md`
- `docs/forecast-artifact-registry.md`
- `config/forecast_catalog.json`
- `frontend/src/forecast/catalog/layer.ts`
- `frontend/src/forecast/catalog/particle.ts`
- `config/pipeline/base.json`

This document records model support. It does not define the canonical layer set,
particle layer set, artifact schema, display metadata, or artifact encodings.
It also does not document operational forecast-hour windows.

## Status Vocabulary

- `native`: the model publishes the required artifact from direct upstream
  fields.
- `frontend-derived`: the frontend computes the layer from a model-published
  artifact.
- `etl-derived`: ETL computes the required artifact from model source fields.
- `unavailable`: the model does not publish the required artifact.

The status describes model support for the frontend catalog choice. Unit
normalization and scalar encoding are artifact concerns; they are documented in
`forecast-artifact-registry.md`.

## Frontend Source Requirements

These requirements come from the frontend layer and particle catalogs.

| Catalog id | Kind | Required artifact(s) | Optional artifact(s) | Frontend recipe |
| --- | --- | --- | --- | --- |
| `temperature` | layer | `tmp_surface` | - | direct scalar |
| `apparent_temperature` | layer | `aptmp_surface` | - | direct scalar |
| `dew_point` | layer | `dewpoint_surface` | - | direct scalar |
| `relative_humidity` | layer | `rh_surface` | - | direct scalar |
| `wind_speed` | layer | `wind10m_uv` | - | `wind-speed` derived field |
| `wind_gust` | layer | `gust_surface` | - | direct scalar |
| `air_pressure` | layer | `prmsl_msl` | - | direct scalar |
| `pressure_contours` | map overlay | `prmsl_msl` | - | toggleable GPU 4 hPa mean-sea-level pressure contours |
| `precipitation_rate` | layer | `prate_surface` | `precip_type_surface` | direct scalar plus automatic precipitation-type pattern overlay |
| `accumulated_precipitation` | layer | `precip_total_surface` | - | direct scalar |
| `snow_depth` | layer | `snow_depth_surface` | - | direct scalar |
| `cloud_layers` | layer | `cloud_layers` | - | custom cloud layers renderer |
| `cloud_cover` | layer | `tcdc` | - | direct scalar |
| `visibility` | layer | `visibility_surface` | - | direct scalar |
| `freezing_level` | layer | `freezing_level` | - | direct scalar |
| `precipitable_water` | layer | `precipitable_water` | - | direct scalar |
| `cape` | layer | `cape_index` | - | direct scalar |
| `cin` | layer | `cin_index` | - | direct scalar |
| `composite_reflectivity` | layer | `refc_entire_atmosphere` | - | direct scalar |
| `wind` | particle layer | `wind10m_uv` | - | direct vector particles |

## Support Matrix

| Catalog id | GFS | ICON | Notes |
| --- | --- | --- | --- |
| `temperature` | `native` | `native` | Both models publish near-surface temperature. |
| `apparent_temperature` | `native` | `unavailable` | ICON does not publish `aptmp_surface`. |
| `dew_point` | `native` | `native` | Both models publish near-surface dew point. |
| `relative_humidity` | `native` | `native` | Both models publish near-surface relative humidity. |
| `wind_speed` | `frontend-derived` | `frontend-derived` | Derived from `wind10m_uv` in the frontend. |
| `wind_gust` | `native` | `native` | Both models publish gust speed. |
| `air_pressure` | `native` | `native` | Both models publish mean sea-level pressure as `prmsl_msl`; ICON publishes it on a downsampled `0.25` grid. |
| `pressure_contours` | `native` | `native` | Toggleable frontend GPU contour overlay from lightly smoothed `prmsl_msl`; ICON uses the downsampled `0.25` pressure artifact. |
| `precipitation_rate` | `native` | `etl-derived` | GFS rate is direct; ICON rate is derived from `tot_prec`. Both can use optional `precip_type_surface` snowflake / ice-dash pattern overlays. |
| `accumulated_precipitation` | `etl-derived` | `native` | GFS publishes `precip_total_surface` from run-total `APCP`, with `f000` synthesized as zero; ICON uses `tot_prec`. |
| `snow_depth` | `native` | `native` | Both models publish snow depth. |
| `cloud_layers` | `frontend-derived` | `frontend-derived` | Custom renderer consumes packed low/middle/high cloud cover components. |
| `cloud_cover` | `native` | `native` | Both models publish total cloud cover. |
| `visibility` | `native` | `unavailable` | ICON does not publish `visibility_surface`. |
| `freezing_level` | `native` | `native` | Both models publish freezing-level height. |
| `precipitable_water` | `native` | `native` | Both models publish precipitable water. |
| `cape` | `native` | `native` | Both models publish mixed-layer CAPE. |
| `cin` | `native` | `unavailable` | GFS publishes mixed-layer CIN; global ICON does not publish `cin_ml` through the configured source. |
| `composite_reflectivity` | `native` | `unavailable` | GFS publishes composite reflectivity; ICON has no configured equivalent. |
| `wind` | `native` | `native` | Particle layer uses `wind10m_uv`. |

## GFS Mapping

GFS model id: `gfs`.

| Catalog id | Support | Artifact(s) | GFS source / derivation | Frontend recipe | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | `native` | `tmp_surface` | `TMP`, `2-HTGL` | direct scalar | - |
| `apparent_temperature` | `native` | `aptmp_surface` | `APTMP`, `2-HTGL` | direct scalar | - |
| `dew_point` | `native` | `dewpoint_surface` | `DPT`, `2-HTGL` | direct scalar | - |
| `relative_humidity` | `native` | `rh_surface` | `RH`, `2-HTGL` | direct scalar | - |
| `wind_speed` | `frontend-derived` | `wind10m_uv` | `UGRD`/`VGRD`, `10-HTGL` | `wind-speed` | Requires ordered `u`, `v` components. |
| `wind_gust` | `native` | `gust_surface` | `GUST`, `0-SFC` | direct scalar | - |
| `air_pressure` | `native` | `prmsl_msl` | `PRMSL`, `0-MSL` | direct scalar | Mean sea-level pressure, not surface pressure. |
| `pressure_contours` | `native` | `prmsl_msl` | `PRMSL`, `0-MSL` | map overlay | Uses the same mean-sea-level pressure artifact as `air_pressure`; controlled by the map options UI and lightly smoothed at render time. |
| `precipitation_rate` | `native` | `prate_surface`; optional `precip_type_surface` | `PRATE`, `0-SFC`, `GRIB_PDS_PDTN=0`; overlay from `PRATE`/`CPOFP`/category fields | direct scalar plus automatic overlay | `prate_surface` is normalized to `mm/hr`; overlay remains optional. |
| `accumulated_precipitation` | `etl-derived` | `precip_total_surface` | run-total `APCP`, `0-SFC`; `f000` synthesized as zero | direct scalar | Run-total precipitation since model reference time. |
| `snow_depth` | `native` | `snow_depth_surface` | `SNOD`, `0-SFC` | direct scalar | - |
| `cloud_layers` | `frontend-derived` | `cloud_layers` | `LCDC`/`MCDC`/`HCDC` | custom cloud layers renderer | Requires ordered `low`, `middle`, `high` components. |
| `cloud_cover` | `native` | `tcdc` | `TCDC`, `0-EATM` | direct scalar | - |
| `visibility` | `native` | `visibility_surface` | `VIS`, `0-SFC` | direct scalar | - |
| `freezing_level` | `native` | `freezing_level` | `HGT`, `0-0DEG` | direct scalar | - |
| `precipitable_water` | `native` | `precipitable_water` | `PWAT`, `0-EATM` | direct scalar | - |
| `cape` | `native` | `cape_index` | `CAPE`, `18000-0-SPDL` | direct scalar | Mixed-layer CAPE. |
| `cin` | `native` | `cin_index` | `CIN`, `18000-0-SPDL` | direct scalar | Mixed-layer CIN normalized to positive magnitude. |
| `composite_reflectivity` | `native` | `refc_entire_atmosphere` | `REFC`, `0-EATM` | direct scalar | Forecast composite reflectivity for simulated radar. |
| `wind` | `native` | `wind10m_uv` | `UGRD`/`VGRD`, `10-HTGL` | direct vector particles | Requires ordered `u`, `v` components. |

## ICON Mapping

ICON model id: `icon`.

| Catalog id | Support | Artifact(s) | ICON source / derivation | Frontend recipe | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | `native` | `tmp_surface` | `t_2m` | direct scalar | - |
| `apparent_temperature` | `unavailable` | - | - | - | `aptmp_surface` is not in the ICON workload. |
| `dew_point` | `native` | `dewpoint_surface` | `td_2m` | direct scalar | - |
| `relative_humidity` | `native` | `rh_surface` | `relhum_2m` | direct scalar | - |
| `wind_speed` | `frontend-derived` | `wind10m_uv` | `u_10m`/`v_10m` | `wind-speed` | Requires ordered `u`, `v` components. |
| `wind_gust` | `native` | `gust_surface` | `vmax_10m` | direct scalar | - |
| `air_pressure` | `native` | `prmsl_msl` | `pmsl` | direct scalar | Mean sea-level pressure, not surface pressure; ETL downsamples this ICON artifact from `0.125` to `0.25` before encoding. |
| `pressure_contours` | `native` | `prmsl_msl` | `pmsl` | map overlay | Uses the same downsampled mean-sea-level pressure artifact as `air_pressure`; controlled by the map options UI and lightly smoothed at render time. |
| `precipitation_rate` | `etl-derived` | `prate_surface`; optional `precip_type_surface` | `prate_surface` from `icon_tot_prec_delta_rate` using `tot_prec`; overlay from rain/snow accumulation component deltas | direct scalar plus automatic overlay | First-hour previous accumulation is treated as zero by the ETL derivation; overlay remains optional. |
| `accumulated_precipitation` | `native` | `precip_total_surface` | `tot_prec` | direct scalar | Run-total precipitation since model reference time. |
| `snow_depth` | `native` | `snow_depth_surface` | `h_snow` | direct scalar | - |
| `cloud_layers` | `frontend-derived` | `cloud_layers` | `clcl`/`clcm`/`clch` | custom cloud layers renderer | Requires ordered `low`, `middle`, `high` components on the `0.125` grid. |
| `cloud_cover` | `native` | `tcdc` | `clct` | direct scalar | - |
| `visibility` | `unavailable` | - | - | - | `visibility_surface` is not in the ICON workload. |
| `freezing_level` | `native` | `freezing_level` | `hzerocl` | direct scalar | - |
| `precipitable_water` | `native` | `precipitable_water` | `tqv` | direct scalar | - |
| `cape` | `native` | `cape_index` | `cape_ml` | direct scalar | Mixed-layer CAPE. |
| `cin` | `unavailable` | - | - | - | Global ICON does not publish `cin_ml` through the configured source; `cin_ml` is available in separate ICON-D2 products. |
| `composite_reflectivity` | `unavailable` | - | - | - | No ICON reflectivity equivalent is configured. |
| `wind` | `native` | `wind10m_uv` | `u_10m`/`v_10m` | direct vector particles | Requires ordered `u`, `v` components. |

## Supporting Artifacts

These artifacts are model outputs that support custom renderers or overlays.

| Artifact id | GFS | ICON | Frontend use | Notes |
| --- | --- | --- | --- | --- |
| `cloud_layers` | `native` vector from `LCDC`/`MCDC`/`HCDC` | `native` vector from `clcl`/`clcm`/`clch` | Selectable `cloud_layers` layer | Packed low/middle/high cloud cover for the Cloud Layers renderer. |
| `precip_type_surface` | `etl-derived` soft snow/mix fractions from GFS precipitation-type inputs | `etl-derived` soft snow/mix fractions from rain/snow accumulation components | Optional automatic `precipitation_rate` pattern overlay | The layer remains available when this artifact is missing. |
| `thunderstorm_mask` | `unavailable` | `etl-derived` from `ww` | No current catalog consumer | Published by ICON when configured; reserved for future thunderstorm rendering. |

## Update Workflow

When changing model support:

1. Update the ETL config workload and model artifact mapping.
2. Update `forecast-artifact-registry.md` if artifact semantics changed.
3. Update `forecast-layer-registry.md` if user-facing catalog behavior changed.
4. Update this document from the resulting ETL config and frontend catalog.
5. Run ETL config tests and affected frontend catalog tests.
