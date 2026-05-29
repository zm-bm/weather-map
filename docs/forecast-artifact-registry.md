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
7. `finite_value_range`, when present, is the finite transformed-value clamp
   applied after `source_transform` and before quantization. It is an ETL
   payload contract, not a frontend display range.
8. Unless an artifact documents a no-sentinel fallback, non-finite source or
   transformed values publish nodata when the encoding declares a nodata
   sentinel.

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

Artifacts that directly back current raster layers.

| Artifact id | Kind | Semantic summary | Units | Components | Time semantics | Encoding | Consumed by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tmp_surface` | `scalar` | Near-surface screen temperature. | `C` | `value` | instantaneous | `tmp_surface_i8_temp_c_piecewise_v1`; temp-c-piecewise-i8-v1; int8; nodata `-128` | layer `temperature` | Uses the shared temperature piecewise int8 encoding. Finite values clip to `-35..50 C` inside the codec. |
| `aptmp_surface` | `scalar` | Near-surface apparent or perceived temperature. | `C` | `value` | instantaneous | `tmp_surface_i8_temp_c_piecewise_v1`; temp-c-piecewise-i8-v1; int8; nodata `-128` | layer `apparent_temperature` | Uses the same temperature encoding as `tmp_surface`; finite values clip to `-35..50 C` inside the codec. |
| `dewpoint_surface` | `scalar` | Near-surface dew point temperature. | `C` | `value` | instantaneous | `dewpoint_surface_i8_0p5c_v1`; linear-i8-v1; int8; scale `0.5`; offset `0`; nodata `-128` | layer `dew_point` | — |
| `rh_surface` | `scalar` | Near-surface relative humidity. | `%` | `value` | instantaneous | `rh_surface_i8_1pct_v1`; linear-i8-v1; int8; scale `1`; offset `50`; nodata `-128`; finite_value_range `0..100` | layer `relative_humidity` | Finite source values clamp to the natural percent range before quantization. |
| `gust_surface` | `scalar` | Near-surface wind gust speed. | `m/s` | `value` | instantaneous | `gust_surface_i8_0p5ms_v1`; linear-i8-v1; int8; scale `0.5`; offset `63.5`; nodata `-128`; finite_value_range `0..60` | layer `wind_gust` | Finite source values clamp to the layer display range before quantization. |
| `prmsl_msl` | `scalar` | Mean sea-level pressure. | `Pa` | `value` | instantaneous | `prmsl_msl_i8_50pa_v1`; linear-i8-v1; int8; scale `50`; offset `100500`; nodata `-128`; finite_value_range `94150..106850` | layer `air_pressure`; map overlay `pressure_contours` | Semantic level is mean sea level. ICON source is regridded to `0.125` then downsampled to `0.25` before publishing this artifact. |
| `tcdc` | `scalar` | Total cloud cover across the atmospheric column. | `%` | `value` | instantaneous | `tcdc_i8_4pct_v1`; linear-i8-v1; int8; scale `4`; offset `0`; nodata `-128`; finite_value_range `0..100` | layer `cloud_cover` | Finite source values clamp to the natural percent range before quantization. |
| `prate_surface` | `scalar` | Precipitation rate normalized to millimeters per hour. | `mm/hr` | `value` | rate or source-interval average rate | `prate_surface_i8_0p15mmhr_v1`; linear-i8-v1; int8; scale `0.15`; offset `19.05`; nodata `-128`; finite_value_range `0..38.1` | layer `precipitation_rate` | Source transform converts kg/m²/s to mm/hr before finite clamp. |
| `precip_total_surface` | `scalar` | Run-total precipitation since model reference time. | `mm` | `value` | run total / source accumulation | `precip_total_surface_i8_1mm_v1`; linear-i8-v1; int8; scale `1`; offset `127`; nodata `-128`; finite_value_range `0..254` | layer `accumulated_precipitation` | GFS synthesizes zero at `f000` and uses run-total `APCP` afterward; ICON uses `tot_prec`. Fixed-window accumulation layers need separate artifacts. |
| `snow_depth_surface` | `scalar` | Snow depth on the ground. | `m` | `value` | instantaneous | `snow_depth_surface_i8_0p012m_v1`; linear-i8-v1; int8; scale `3/254` (`~0.011811 m`); offset `1.5`; nodata `-128`; finite_value_range `0..3` | layer `snow_depth` | GFS `SNOD` source nodata over open water must remain artifact nodata before finite clamp. |
| `visibility_surface` | `scalar` | Horizontal surface visibility. | `m` | `value` | instantaneous | `visibility_surface_i8_200m_v1`; linear-i8-v1; int8; scale `200`; offset `25400`; nodata `-128`; finite_value_range `0..50800` | layer `visibility` | — |
| `freezing_level` | `scalar` | Height of the 0C isotherm. | `m` | `value` | instantaneous | `freezing_level_i8_32m_v1`; linear-i8-v1; int8; scale `32`; offset `4064`; nodata `-128`; finite_value_range `0..8128` | layer `freezing_level` | — |
| `precipitable_water` | `scalar` | Column-integrated water vapor as liquid water depth. | `mm` | `value` | instantaneous | `precipitable_water_i8_0p32mm_v1`; linear-i8-v1; int8; scale `0.32`; offset `40.64`; nodata `-128`; finite_value_range `0..81.28` | layer `precipitable_water` | — |
| `cape_index` | `scalar` | Mixed-layer convective available potential energy. | `J/kg` | `value` | instantaneous | `cape_index_i8_20jkg_v1`; linear-i8-v1; int8; scale `20`; offset `2540`; nodata `-128`; finite_value_range `0..5080` | layer `cape` | — |
| `cin_index` | `scalar` | Mixed-layer convective inhibition displayed as positive cap-strength magnitude. | `J/kg` | `value` | instantaneous | `cin_index_i8_2jkg_v1`; linear-i8-v1; int8; scale `2`; offset `254`; nodata `-128`; finite_value_range `0..508` | layer `cin` | Source transform converts signed CIN to positive magnitude before finite clamp. Currently configured for GFS only. |
| `refc_entire_atmosphere` | `scalar` | Forecast composite reflectivity across the atmospheric column. | `dBZ` | `value` | instantaneous | `refc_entire_atmosphere_i8_0p5dbz_v1`; linear-i8-v1; int8; scale `0.5`; offset `31.5`; nodata `-128`; finite_value_range `0..75` | layer `composite_reflectivity` | Model output for simulated radar, not observed radar. |

## Particle And Derived Field Sources

Artifacts consumed by particle layers or frontend-derived raster recipes. These
artifacts are not listed as direct raster-layer sources unless they also back a
selectable raster layer directly.

| Artifact id | Kind | Semantic summary | Units | Components | Time semantics | Encoding | Consumed by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wind10m_uv` | `vector` | 10m horizontal wind vector with ordered u/v components. | `m/s` | `u`, `v` | instantaneous | `wind10m_uv_vector_i8_1ms_v1`; linear-i8-v1; int8; scale `1`; offset `0`; finite_value_range `-64..64` | derived layer `wind_speed`; particle layer `wind` | No nodata value is declared in the catalog encoding. If either source component is non-finite for a cell, ETL encodes both components as `0 m/s`. |

## Renderer Support Artifacts

Artifacts published for custom renderers, overlays, or future derived products.

| Artifact id | Kind | Semantic summary | Units | Components | Time semantics | Encoding | Consumed by | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cloud_layers` | `vector` | Low, middle, and high cloud-layer cover packed for the planes renderer `cloud-layers` style. | `%` | `low`, `middle`, `high` | instantaneous | `cloud_layers_vector_i8_4pct_v1`; linear-i8-v1; int8; scale `4`; offset `0`; nodata `-128`; finite_value_range `0..100` | layer `cloud_layers` | Source artifact for the selectable Cloud Layers visualization. |
| `precip_type_surface` | `vector` | Soft precipitation-type overlay fractions derived from model precipitation-type inputs. | `fraction` | `snow_frac`, `mix_frac` | source-interval derived overlay | `precip_type_surface_i8_frac_v1`; linear-i8-v1; int8; scale `0.003937007874015748`; offset `0.5`; nodata `-128`; finite_value_range `0..1` | automatic `precipitation_rate` pattern overlay | Optional GFS/ICON artifact; precipitation intensity still renders when this artifact is missing. |
| `thunderstorm_mask` | `scalar` | Normalized thunderstorm flag mask. | `flag` | `value` | instantaneous | `thunderstorm_mask_i8_flag_v1`; linear-i8-v1; int8; scale `1`; offset `0`; nodata `-128`; finite_value_range `0..1` | future thunderstorm rendering; no current selectable layer | Published when configured by a model; not currently consumed by the frontend catalog. |

## Normalized Value Tables

### `cloud_layers`

`cloud_layers` backs the selectable Cloud Layers visualization through the
planes renderer `cloud-layers` style. The payload
stores three same-grid component bands in fixed order:

| Component | Range | Meaning |
| --- | --- | --- |
| `low` | `0..100` | Low cloud-layer cover percentage. |
| `middle` | `0..100` | Middle cloud-layer cover percentage. |
| `high` | `0..100` | High cloud-layer cover percentage. |

The byte payload layout is all `low` cells, followed by all `middle` cells,
then all `high` cells. Non-finite source values publish nodata for the affected
component cell. Finite source values clamp to `0..100%` before quantization.
Values are quantized in 4 percentage-point buckets.

### `precip_type_surface`

The artifact stores soft precipitation-type fractions instead of hard
categories such as `rain = 0`, `snow = 1`, `mix = 2`. Soft fields avoid blocky
type boundaries on coarse model grids and let the frontend interpolate type
transitions independently from precipitation intensity.

| Component | Range | Meaning |
| --- | --- | --- |
| `snow_frac` | `0..1` | Snow overlay strength. |
| `mix_frac` | `0..1` | Winter-mix overlay strength for freezing rain / ice pellets / mixed signals. |

The artifact is only an overlay contract. Total precipitation intensity remains
`prate_surface`, normalized to liquid-water-equivalent `mm/hr`.

GFS derivation inputs are `PRATE`, `CPOFP`, `CRAIN`, `CSNOW`, `CFRZR`, and
`CICEP` at the surface. `PRATE * 3600` gates overlays below `0.05 mm/hr`.
Freezing rain and ice pellets map to `mix_frac = 1`; explicit snow plus rain
maps to `snow_frac = 0.25`, `mix_frac = 0.75`; snow maps to `snow_frac = 1`;
rain maps to no overlay. Ambiguous cases use `CPOFP / 100` as frozen fraction:

```txt
snow_frac = smoothstep(0.55, 0.85, frozen_fraction)
mix_frac  = smoothBand(frozen_fraction, 0.25, 0.75)
```

ICON derivation inputs are `rain_gsp`, `rain_con`, `snow_gsp`, and `snow_con`.
The ETL uses adjacent forecast-hour accumulation deltas and treats the first
configured previous value as zero. It computes:

```txt
rain = delta(rain_gsp) + delta(rain_con)
snow = delta(snow_gsp) + delta(snow_con)
total = rain + snow
snow_ratio = snow / total

snow_frac = smoothstep(0.65, 0.95, snow_ratio)
mix_frac  = smoothBand(snow_ratio, 0.25, 0.75)
```

Both derivations clamp `snow_frac` to `0..1` and `mix_frac` to
`0..1 - snow_frac`; non-finite source values publish nodata for both
components. `smoothBand(value, low, high)` rises from `low` to `0.5` and falls
from `0.5` to `high`.

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
