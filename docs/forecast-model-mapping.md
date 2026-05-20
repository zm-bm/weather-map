# Forecast Model Mapping

Concrete mapping from forecast models to Weather Map frontend catalog choices.
Keep this document in sync with:

- `docs/forecast-layer-registry.md`
- `docs/forecast-artifact-registry.md`
- `config/forecast_catalog.json`
- `frontend/src/forecast-catalog/layer.ts`
- `frontend/src/forecast-catalog/particle.ts`
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
- `composite`: the frontend combines a base artifact with an optional overlay
  artifact.
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
| `precipitation_rate` | layer | `prate_surface` | - | direct scalar |
| `accumulated_precipitation` | layer | `precip_total_surface` | - | direct scalar |
| `snow_depth` | layer | `snow_depth_surface` | - | direct scalar |
| `cloud_cover` | layer | `tcdc` | - | direct scalar |
| `low_cloud_cover` | layer | `low_clouds` | - | direct scalar |
| `middle_cloud_cover` | layer | `medium_clouds` | - | direct scalar |
| `high_cloud_cover` | layer | `high_clouds` | - | direct scalar |
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
| `air_pressure` | `native` | `native` | Both models publish mean sea-level pressure as `prmsl_msl`. |
| `precipitation_rate` | `native` | `etl-derived` | GFS rate is direct; ICON rate is derived from `tot_prec`. Type overlay artifacts are staged separately and are not rendered by this layer yet. |
| `accumulated_precipitation` | `unavailable` | `native` | GFS does not publish `precip_total_surface`. |
| `snow_depth` | `native` | `native` | Both models publish snow depth. |
| `cloud_cover` | `native` | `native` | Both models publish total cloud cover. |
| `low_cloud_cover` | `native` | `native` | Both models publish low cloud layer cover. |
| `middle_cloud_cover` | `native` | `native` | Both models publish middle cloud layer cover. |
| `high_cloud_cover` | `native` | `native` | Both models publish high cloud layer cover. |
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
| `precipitation_rate` | `native` | `prate_surface` | `PRATE`, `0-SFC`, `GRIB_PDS_PDTN=0` | direct scalar | `prate_surface` is normalized to `mm/hr`. |
| `accumulated_precipitation` | `unavailable` | - | - | - | `precip_total_surface` is not in the GFS workload. |
| `snow_depth` | `native` | `snow_depth_surface` | `SNOD`, `0-SFC` | direct scalar | - |
| `cloud_cover` | `native` | `tcdc` | `TCDC`, `0-EATM` | direct scalar | - |
| `low_cloud_cover` | `native` | `low_clouds` | `LCDC` | direct scalar | - |
| `middle_cloud_cover` | `native` | `medium_clouds` | `MCDC` | direct scalar | - |
| `high_cloud_cover` | `native` | `high_clouds` | `HCDC` | direct scalar | - |
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
| `air_pressure` | `native` | `prmsl_msl` | `pmsl` | direct scalar | Mean sea-level pressure, not surface pressure. |
| `precipitation_rate` | `etl-derived` | `prate_surface` | `prate_surface` from `icon_tot_prec_delta_rate` using `tot_prec` | direct scalar | First-hour previous accumulation is treated as zero by the ETL derivation. |
| `accumulated_precipitation` | `native` | `precip_total_surface` | `tot_prec` | direct scalar | Source accumulation total. |
| `snow_depth` | `native` | `snow_depth_surface` | `h_snow` | direct scalar | - |
| `cloud_cover` | `native` | `tcdc` | `clct` | direct scalar | - |
| `low_cloud_cover` | `native` | `low_clouds` | `clcl` | direct scalar | - |
| `middle_cloud_cover` | `native` | `medium_clouds` | `clcm` | direct scalar | - |
| `high_cloud_cover` | `native` | `high_clouds` | `clch` | direct scalar | - |
| `visibility` | `unavailable` | - | - | - | `visibility_surface` is not in the ICON workload. |
| `freezing_level` | `native` | `freezing_level` | `hzerocl` | direct scalar | - |
| `precipitable_water` | `native` | `precipitable_water` | `tqv` | direct scalar | - |
| `cape` | `native` | `cape_index` | `cape_ml` | direct scalar | Mixed-layer CAPE. |
| `cin` | `unavailable` | - | - | - | Global ICON does not publish `cin_ml` through the configured source; `cin_ml` is available in separate ICON-D2 products. |
| `composite_reflectivity` | `unavailable` | - | - | - | No ICON reflectivity equivalent is configured. |
| `wind` | `native` | `wind10m_uv` | `u_10m`/`v_10m` | direct vector particles | Requires ordered `u`, `v` components. |

## Supporting Artifacts

These artifacts are model outputs but are not standalone selectable catalog
choices.

| Artifact id | GFS | ICON | Frontend use | Notes |
| --- | --- | --- | --- | --- |
| `precip_type_surface` | `etl-derived` soft snow/mix fractions from GFS precipitation-type inputs | `etl-derived` soft snow/mix fractions from rain/snow accumulation components | Future precipitation type overlay rendering | Staged GFS/ICON artifact with `snow_frac` and `mix_frac` components; no current frontend consumer. |
| `thunderstorm_mask` | `unavailable` | `etl-derived` from `ww` | No current catalog consumer | Published by ICON when configured; reserved for future thunderstorm rendering. |

## Update Workflow

When changing model support:

1. Update the ETL config workload and model artifact mapping.
2. Update `forecast-artifact-registry.md` if artifact semantics changed.
3. Update `forecast-layer-registry.md` if user-facing catalog behavior changed.
4. Update this document from the resulting ETL config and frontend catalog.
5. Run ETL config tests and affected frontend catalog tests.
