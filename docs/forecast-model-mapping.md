# Forecast Model Mapping

Concrete mapping from forecast models to Weather Map frontend catalog choices.
Keep this document in sync with:

- `docs/forecast-layer-registry.md`
- `docs/forecast-artifact-registry.md`
- `config/forecast_catalog.json`
- `frontend/src/forecast/catalog/entries.ts`
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

These requirements come from the frontend raster layer, overlay layer, contour
layer, and particle layer catalogs. Every loadable catalog entry uses
`source: { artifactId, bands }`; raster layer bands also carry palette ids for
display.

| Catalog id | Kind | Required artifact(s) | Optional artifact(s) | Frontend recipe |
| --- | --- | --- | --- | --- |
| `temperature` | raster layer | `tmp_surface` | - | source band `value` |
| `apparent_temperature` | raster layer | `aptmp_surface` | - | source band `value` |
| `dew_point` | raster layer | `dewpoint_surface` | - | source band `value` |
| `relative_humidity` | raster layer | `rh_surface` | - | source band `value` |
| `wind_speed` | raster layer | `wind10m_uv` | - | source bands `u`, `v`; raster renderer/probes compute speed |
| `wind_gust` | raster layer | `gust_surface` | - | source band `value` |
| `air_pressure` | raster layer | `prmsl_msl` | - | source band `value` |
| `pressure_contours` | contour layer | `prmsl_msl` | - | source band `value`; toggleable GPU 4 hPa mean-sea-level pressure contours |
| `precipitation_rate` | raster layer | `prate_surface` | `precip_type_surface` | source band `value`; references automatic precipitation-type pattern overlay |
| `precipitation_type` | overlay layer | `precip_type_surface` | - | source bands `snow_frac`, `mix_frac`; automatic snow / winter-mix pattern overlay for `precipitation_rate` |
| `accumulated_precipitation` | raster layer | `precip_total_surface` | - | source band `value` |
| `snow_depth` | raster layer | `snow_depth_surface` | - | source band `value` |
| `cloud_layers` | raster layer | `cloud_layers` | - | source bands `low`, `middle`, `high`; raster cloud compositor |
| `cloud_cover` | raster layer | `tcdc` | - | source band `value` |
| `visibility` | raster layer | `visibility_surface` | - | source band `value` |
| `freezing_level` | raster layer | `freezing_level` | - | source band `value` |
| `precipitable_water` | raster layer | `precipitable_water` | - | source band `value` |
| `cape` | raster layer | `cape_index` | - | source band `value` |
| `cin` | raster layer | `cin_index` | - | source band `value` |
| `composite_reflectivity` | raster layer | `refc_entire_atmosphere` | - | source band `value` |
| `wind` | particle layer | `wind10m_uv` | - | source bands `u`, `v`; animated particles |

## Support Matrix

| Catalog id | GFS | ICON | Notes |
| --- | --- | --- | --- |
| `temperature` | `native` | `native` | Both models publish near-surface temperature. |
| `apparent_temperature` | `native` | `unavailable` | ICON does not publish `aptmp_surface`. |
| `dew_point` | `native` | `native` | Both models publish near-surface dew point. |
| `relative_humidity` | `native` | `native` | Both models publish near-surface relative humidity. |
| `wind_speed` | `frontend-derived` | `frontend-derived` | The frontend loads `u/v` bands from `wind10m_uv` and renders/probes speed magnitude. |
| `wind_gust` | `native` | `native` | Both models publish gust speed. |
| `air_pressure` | `native` | `native` | Both models publish mean sea-level pressure as `prmsl_msl`; ICON publishes it on a downsampled `0.25` grid. |
| `pressure_contours` | `native` | `native` | Toggleable frontend GPU contour overlay from lightly smoothed `prmsl_msl`; ICON uses the downsampled `0.25` pressure artifact. |
| `precipitation_rate` | `native` | `etl-derived` | GFS rate is direct; ICON rate is derived from `tot_prec`. Both can use optional `precip_type_surface` snowflake / ice-dash pattern overlays. |
| `precipitation_type` | `etl-derived` | `etl-derived` | Automatic optional overlay from `precip_type_surface`; the `precipitation_rate` layer remains available when this artifact is missing. |
| `accumulated_precipitation` | `etl-derived` | `native` | GFS publishes `precip_total_surface` from run-total `APCP`, with `f000` synthesized as zero; ICON uses `tot_prec`. |
| `snow_depth` | `native` | `native` | Both models publish snow depth. |
| `cloud_layers` | `native` | `native` | The raster renderer consumes packed low/middle/high cloud cover components published by each model. |
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
| `temperature` | `native` | `tmp_surface` | `TMP`, `2-HTGL` | source band `value` | - |
| `apparent_temperature` | `native` | `aptmp_surface` | `APTMP`, `2-HTGL` | source band `value` | - |
| `dew_point` | `native` | `dewpoint_surface` | `DPT`, `2-HTGL` | source band `value` | - |
| `relative_humidity` | `native` | `rh_surface` | `RH`, `2-HTGL` | source band `value` | - |
| `wind_speed` | `frontend-derived` | `wind10m_uv` | `UGRD`/`VGRD`, `10-HTGL` | source bands `u`, `v` | Requires ordered `u`, `v` components; frontend renders/probes speed magnitude. |
| `wind_gust` | `native` | `gust_surface` | `GUST`, `0-SFC` | source band `value` | - |
| `air_pressure` | `native` | `prmsl_msl` | `PRMSL`, `0-MSL` | source band `value` | Mean sea-level pressure, not surface pressure. |
| `pressure_contours` | `native` | `prmsl_msl` | `PRMSL`, `0-MSL` | contour source band `value` | Uses the same mean-sea-level pressure artifact as `air_pressure`; controlled by the map options UI and lightly smoothed at render time. |
| `precipitation_rate` | `native` | `prate_surface`; optional `precip_type_surface` | `PRATE`, `0-SFC`, `GRIB_PDS_PDTN=0`; overlay from `PRATE`/`CPOFP`/category fields | source band `value` plus automatic overlay | `prate_surface` is normalized to `mm/hr`; overlay remains optional. |
| `precipitation_type` | `etl-derived` | `precip_type_surface` | `PRATE`/`CPOFP`/category fields | overlay source bands `snow_frac`, `mix_frac` | Optional snow / winter-mix pattern overlay for `precipitation_rate`. |
| `accumulated_precipitation` | `etl-derived` | `precip_total_surface` | run-total `APCP`, `0-SFC`; `f000` synthesized as zero | source band `value` | Run-total precipitation since model reference time. |
| `snow_depth` | `native` | `snow_depth_surface` | `SNOD`, `0-SFC` | source band `value` | - |
| `cloud_layers` | `native` | `cloud_layers` | `LCDC`/`MCDC`/`HCDC` | source bands `low`, `middle`, `high` | Requires ordered `low`, `middle`, `high` components. |
| `cloud_cover` | `native` | `tcdc` | `TCDC`, `0-EATM` | source band `value` | - |
| `visibility` | `native` | `visibility_surface` | `VIS`, `0-SFC` | source band `value` | - |
| `freezing_level` | `native` | `freezing_level` | `HGT`, `0-0DEG` | source band `value` | - |
| `precipitable_water` | `native` | `precipitable_water` | `PWAT`, `0-EATM` | source band `value` | - |
| `cape` | `native` | `cape_index` | `CAPE`, `18000-0-SPDL` | source band `value` | Mixed-layer CAPE. |
| `cin` | `native` | `cin_index` | `CIN`, `18000-0-SPDL` | source band `value` | Mixed-layer CIN normalized to positive magnitude. |
| `composite_reflectivity` | `native` | `refc_entire_atmosphere` | `REFC`, `0-EATM` | source band `value` | Forecast composite reflectivity for simulated radar. |
| `wind` | `native` | `wind10m_uv` | `UGRD`/`VGRD`, `10-HTGL` | particle source bands `u`, `v` | Requires ordered `u`, `v` components. |

## ICON Mapping

ICON model id: `icon`.

| Catalog id | Support | Artifact(s) | ICON source / derivation | Frontend recipe | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | `native` | `tmp_surface` | `t_2m` | source band `value` | - |
| `apparent_temperature` | `unavailable` | - | - | - | `aptmp_surface` is not in the ICON workload. |
| `dew_point` | `native` | `dewpoint_surface` | `td_2m` | source band `value` | - |
| `relative_humidity` | `native` | `rh_surface` | `relhum_2m` | source band `value` | - |
| `wind_speed` | `frontend-derived` | `wind10m_uv` | `u_10m`/`v_10m` | source bands `u`, `v` | Requires ordered `u`, `v` components; frontend renders/probes speed magnitude. |
| `wind_gust` | `native` | `gust_surface` | `vmax_10m` | source band `value` | - |
| `air_pressure` | `native` | `prmsl_msl` | `pmsl` | source band `value` | Mean sea-level pressure, not surface pressure; ETL downsamples this ICON artifact from `0.125` to `0.25` before encoding. |
| `pressure_contours` | `native` | `prmsl_msl` | `pmsl` | contour source band `value` | Uses the same downsampled mean-sea-level pressure artifact as `air_pressure`; controlled by the map options UI and lightly smoothed at render time. |
| `precipitation_rate` | `etl-derived` | `prate_surface`; optional `precip_type_surface` | `prate_surface` from `icon_tot_prec_delta_rate` using `tot_prec`; overlay from rain/snow accumulation component deltas | source band `value` plus automatic overlay | First-hour previous accumulation is treated as zero by the ETL derivation; overlay remains optional. |
| `precipitation_type` | `etl-derived` | `precip_type_surface` | rain/snow accumulation component deltas | overlay source bands `snow_frac`, `mix_frac` | Optional snow / winter-mix pattern overlay for `precipitation_rate`. |
| `accumulated_precipitation` | `native` | `precip_total_surface` | `tot_prec` | source band `value` | Run-total precipitation since model reference time. |
| `snow_depth` | `native` | `snow_depth_surface` | `h_snow` | source band `value` | - |
| `cloud_layers` | `native` | `cloud_layers` | `clcl`/`clcm`/`clch` | source bands `low`, `middle`, `high` | Requires ordered `low`, `middle`, `high` components on the `0.125` grid. |
| `cloud_cover` | `native` | `tcdc` | `clct` | source band `value` | - |
| `visibility` | `unavailable` | - | - | - | `visibility_surface` is not in the ICON workload. |
| `freezing_level` | `native` | `freezing_level` | `hzerocl` | source band `value` | - |
| `precipitable_water` | `native` | `precipitable_water` | `tqv` | source band `value` | - |
| `cape` | `native` | `cape_index` | `cape_ml` | source band `value` | Mixed-layer CAPE. |
| `cin` | `unavailable` | - | - | - | Global ICON does not publish `cin_ml` through the configured source; `cin_ml` is available in separate ICON-D2 products. |
| `composite_reflectivity` | `unavailable` | - | - | - | No ICON reflectivity equivalent is configured. |
| `wind` | `native` | `wind10m_uv` | `u_10m`/`v_10m` | particle source bands `u`, `v` | Requires ordered `u`, `v` components. |

## Supporting Artifacts

These artifacts are model outputs that support custom renderers or overlays.

| Artifact id | GFS | ICON | Frontend use | Notes |
| --- | --- | --- | --- | --- |
| `cloud_layers` | `native` vector from `LCDC`/`MCDC`/`HCDC` | `native` vector from `clcl`/`clcm`/`clch` | Selectable `cloud_layers` raster layer | Packed low/middle/high cloud cover for the raster renderer cloud-layer style. |
| `precip_type_surface` | `etl-derived` soft snow/mix fractions from GFS precipitation-type inputs | `etl-derived` soft snow/mix fractions from rain/snow accumulation components | Optional automatic `precipitation_rate` pattern overlay | The layer remains available when this artifact is missing. |
| `thunderstorm_mask` | `unavailable` | `etl-derived` from `ww` | No current catalog consumer | Published by ICON when configured; reserved for future thunderstorm rendering. |

## Update Workflow

When changing model support:

1. Update the ETL config workload and model artifact mapping.
2. Update `forecast-artifact-registry.md` if artifact semantics changed.
3. Update `forecast-layer-registry.md` if user-facing catalog behavior changed.
4. Update this document from the resulting ETL config and frontend catalog.
5. Run ETL config tests and affected frontend catalog tests.
