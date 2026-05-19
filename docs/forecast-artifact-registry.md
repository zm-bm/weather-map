# Forecast Artifact Registry

Canonical registry of ETL-produced forecast artifacts. Keep this document in
sync with the `artifact_catalog` entries in `config/pipeline/base.json`.

This document defines what ETL can publish and what each payload means.

It does **not** define user-facing layer grouping, labels, product taxonomy, or
frontend display defaults.

Related docs:

- `terminology.md`: shared vocabulary
- `forecast-layer-registry.md`: user-facing layers and particle layers
- `forecast-model-mapping.md`: model-to-layer support using artifacts

## Scope And Rules

1. An artifact is an ETL-produced payload advertised by cycle manifests.
2. `artifact_id` is owned by ETL and is part of manifest keys, artifact paths, and status marker paths.
3. Artifact ids may include implementation, parameter, or level detail when that detail identifies the payload.
4. Supporting artifacts can exist without becoming selectable layers.
5. Encoding, component order, and payload semantics belong here.
6. User-facing labels, groups, and display defaults do not belong here.

## Record Shape

Each artifact row records:

- `artifact_id`
- `kind`
- semantic summary
- units
- components
- time semantics
- encoding family
- current frontend consumers
- notes

`Consumed by` is informational. It names current frontend catalog consumers but
does not make an artifact user-selectable. Canonical user-facing layer
definitions live in `forecast-layer-registry.md`.

## Selectable Field Sources

Artifacts that directly back current field layers. For composite layers, the
consumer column names the artifact's role in that frontend recipe.

| Artifact id | Kind | Semantic summary | Units | Components | Time semantics | Encoding | Consumed by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tmp_surface` | `scalar` | Near-surface screen temperature. | `C` | `value` | instantaneous | `tmp_surface_i8_temp_c_piecewise_v1`; temp-c-piecewise-i8-v1; int8; nodata `-128` | layer `temperature` | Uses the shared temperature piecewise int8 encoding. |
| `aptmp_surface` | `scalar` | Near-surface apparent or perceived temperature. | `C` | `value` | instantaneous | `tmp_surface_i8_temp_c_piecewise_v1`; temp-c-piecewise-i8-v1; int8; nodata `-128` | layer `apparent_temperature` | Uses the same temperature encoding as `tmp_surface`. |
| `dewpoint_surface` | `scalar` | Near-surface dew point temperature. | `C` | `value` | instantaneous | `dewpoint_surface_i8_0p5c_v1`; linear-i8-v1; int8; scale `0.5`; offset `0`; nodata `-128` | layer `dew_point` | — |
| `rh_surface` | `scalar` | Near-surface relative humidity. | `%` | `value` | instantaneous | `rh_surface_i8_1pct_v1`; linear-i8-v1; int8; scale `1`; offset `50`; nodata `-128` | layer `relative_humidity` | — |
| `gust_surface` | `scalar` | Near-surface wind gust speed. | `m/s` | `value` | instantaneous | `gust_surface_i8_1ms_v1`; linear-i8-v1; int8; scale `0.5`; offset `63.5`; nodata `-128` | layer `wind_gust` | — |
| `prmsl_msl` | `scalar` | Mean sea-level pressure. | `Pa` | `value` | instantaneous | `prmsl_msl_i8_25pa_v1`; linear-i8-v1; int8; scale `25`; offset `100500`; nodata `-128` | layer `air_pressure` | Semantic level is mean sea level. |
| `tcdc` | `scalar` | Total cloud cover across the atmospheric column. | `%` | `value` | instantaneous | `tcdc_i8_0p5pct_v1`; linear-i8-v1; int8; scale `1`; offset `50`; nodata `-128` | layer `cloud_cover` | — |
| `low_clouds` | `scalar` | Low cloud layer cover. | `%` | `value` | instantaneous | `low_clouds_i8_1pct_v1`; linear-i8-v1; int8; scale `1`; offset `50`; nodata `-128` | layer `low_cloud_cover` | — |
| `medium_clouds` | `scalar` | Middle cloud layer cover. | `%` | `value` | instantaneous | `medium_clouds_i8_1pct_v1`; linear-i8-v1; int8; scale `1`; offset `50`; nodata `-128` | layer `middle_cloud_cover` | — |
| `high_clouds` | `scalar` | High cloud layer cover. | `%` | `value` | instantaneous | `high_clouds_i8_1pct_v1`; linear-i8-v1; int8; scale `1`; offset `50`; nodata `-128` | layer `high_cloud_cover` | — |
| `prate_surface` | `scalar` | Precipitation rate normalized to millimeters per hour. | `mm/hr` | `value` | rate or source-interval average rate | `prate_surface_i8_0p15mmhr_v1`; linear-i8-v1; int8; scale `0.15`; offset `19.05`; nodata `-128` | base field for layer `precipitation_rate` | Source transform converts kg/m²/s to mm/hr. |
| `precip_total_surface` | `scalar` | Accumulated precipitation total. | `mm` | `value` | run total / source accumulation | `precip_total_surface_i8_1mm_v1`; linear-i8-v1; int8; scale `1`; offset `127`; nodata `-128` | layer `accumulated_precipitation` | Current `accumulated_precipitation` layer treats this as run total unless a fixed window is declared later. |
| `snow_depth_surface` | `scalar` | Snow depth on the ground. | `m` | `value` | instantaneous | `snow_depth_surface_i8_0p02m_v1`; linear-i8-v1; int8; scale `0.02`; offset `2.54`; nodata `-128` | layer `snow_depth` | — |
| `visibility_surface` | `scalar` | Horizontal surface visibility. | `m` | `value` | instantaneous | `visibility_surface_i8_200m_v1`; linear-i8-v1; int8; scale `200`; offset `25400`; nodata `-128` | layer `visibility` | — |
| `freezing_level` | `scalar` | Height of the 0C isotherm. | `m` | `value` | instantaneous | `freezing_level_i8_32m_v1`; linear-i8-v1; int8; scale `32`; offset `4064`; nodata `-128` | layer `freezing_level` | — |
| `precipitable_water` | `scalar` | Column-integrated water vapor as liquid water depth. | `mm` | `value` | instantaneous | `precipitable_water_i8_0p32mm_v1`; linear-i8-v1; int8; scale `0.32`; offset `40.64`; nodata `-128` | layer `precipitable_water` | — |
| `cape_index` | `scalar` | Mixed-layer convective available potential energy. | `J/kg` | `value` | instantaneous | `cape_index_i8_20jkg_v1`; linear-i8-v1; int8; scale `20`; offset `2540`; nodata `-128` | layer `cape` | — |
| `refc_entire_atmosphere` | `scalar` | Forecast composite reflectivity across the atmospheric column. | `dBZ` | `value` | instantaneous | `refc_entire_atmosphere_i8_0p5dbz_v1`; linear-i8-v1; int8; scale `0.5`; offset `31.5`; nodata `-128` | layer `composite_reflectivity` | Model output for simulated radar, not observed radar. |

## Particle And Derived Field Sources

Artifacts consumed by particle layers or frontend-derived field recipes. These
artifacts are not listed as direct field-layer sources unless they also back a
selectable field layer directly.

| Artifact id | Kind | Semantic summary | Units | Components | Time semantics | Encoding | Consumed by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wind10m_uv` | `vector` | 10m horizontal wind vector with ordered u/v components. | `m/s` | `u`, `v` | instantaneous | `wind10m_uv_vector_i8_v1`; linear-i8-v1; int8; scale `0.5`; offset `0` | derived layer `wind_speed`; particle layer `wind` | No nodata value is declared in the catalog encoding. |

## Supporting Overlays And Classifiers

Artifacts that influence rendering or classification without being selectable by
themselves.

| Artifact id | Kind | Semantic summary | Units | Components | Time semantics | Encoding | Consumed by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `precip_type_surface` | `scalar` | Normalized precipitation-type classifier codes. | `code` | `value` | instantaneous | `precip_type_surface_i8_code_v1`; linear-i8-v1; int8; scale `1`; offset `0`; nodata `-128` | optional classifier overlay for layer `precipitation_rate` | Classifier only; it does not provide precipitation magnitude. |
| `thunderstorm_mask` | `scalar` | Normalized thunderstorm flag mask. | `flag` | `value` | instantaneous | `thunderstorm_mask_i8_flag_v1`; linear-i8-v1; int8; scale `1`; offset `0`; nodata `-128` | future thunderstorm rendering; no current selectable layer | Published when configured by a model; not currently consumed by the frontend catalog. |

## Normalized Value Tables

### `precip_type_surface`

| Value | Meaning |
| --- | --- |
| `0` | none or unknown |
| `1` | rain or drizzle |
| `2` | freezing rain or freezing drizzle |
| `3` | ice pellets or sleet |
| `4` | snow |
| `5` | mixed or other wintry precipitation |

### `thunderstorm_mask`

| Value | Meaning |
| --- | --- |
| `0` | no thunderstorm signal |
| `1` | thunderstorm signal |

## Population Workflow

When adding or changing an ETL artifact:

1. Update `artifact_catalog` in `config/pipeline/base.json`.
2. Update this registry.
3. Update `forecast-model-mapping.md` if model support, upstream selection, or derivation changes.
4. Update the frontend catalog only if user-facing behavior changes.
5. Run ETL config tests and any affected frontend tests before publishing new artifacts.
