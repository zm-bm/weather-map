# Forecast Field Layer Requirements

Last updated: 2026-05-24

Draft staging contract for field-rendered forecast layers. Use this document to
settle layer requirements before updating the canonical artifact and layer
registries.

Related docs:

- `forecast-artifact-registry.md`: canonical ETL artifact definitions
- `forecast-layer-registry.md`: canonical user-facing layer definitions
- `forecast-model-mapping.md`: model-to-layer support using artifacts
- `roadmap.md`: follow-up audit and implementation work

## Scope And Rules

1. This document records draft v1 requirements for current field-rendered
   layers. It is not yet the canonical artifact or layer registry.
2. Existing facts in this document should match `config/forecast_catalog.json`
   and `config/pipeline/base.json`.
3. Display range means renderer color clamp and default legend range. It does
   not automatically mean the artifact cannot preserve a small useful overrange.
4. Probe labels should report decoded physical values. Rendering should clamp
   colors below the display minimum and above the display maximum.
5. ETL should clamp finite extreme values to each layer's agreed encoded range.
   This is a visualization app, so artifact encodings should favor compact,
   render-safe values over preserving unbounded raw extremes.
6. Artifacts may preserve useful overrange beyond the display range when it
   does not materially increase payload size or reduce required in-range
   precision.
7. Keep nodata sentinel support unless an expected-complete artifact has an
   explicit no-sentinel contract. Expected-complete means nodata should be
   investigated as data quality, not that invalid values can be ignored.
8. Preserve natural or critical boundaries exactly when representable. Ordinary
   domain thresholds may tolerate one half of the encoding quantum.
9. Field color sampling remains a global rendering setting. The default stays
   banded.

## V1 Policy Decisions

| Decision | V1 policy |
| --- | --- |
| Display clipping | Clamp rendered colors to each layer's display range. |
| ETL clipping | Clamp finite values to each layer's agreed encoded range. The agreed range may equal the display range or include a small useful overrange. |
| Probe values | Show decoded physical values after ETL clipping, including preserved overrange values, unless the value is nodata. |
| Nodata | Keep nodata support for scalar and cloud-layer artifacts. `wind10m_uv` is expected-complete and uses no nodata sentinel. |
| Invalid source values | Non-finite source values become nodata when an encoding has a sentinel. For no-sentinel `wind10m_uv`, encode a cell as a zero wind vector when either component is invalid. |
| ETL finite clamp path | Use a shared ETL sanitization path that applies each artifact's finite clamp range before quantization. |
| Boundary checks | Test just below, exactly at, and just above required exact boundaries and important thresholds. |
| Threshold exactness | Exact for natural/critical boundaries where representable; half-quantum tolerance for ordinary domain thresholds. |
| Sampling | Keep color sampling as a global rendering setting and default it to banded. |
| Custom palettes | Out of scope except that custom stops should not imply precision finer than the artifact can preserve. |

## Current Inventory

This table records current catalog and artifact facts as of the date above.

| Layer id | Source artifact | Stored unit | Display range | Current encoded range | Current quantum | Nodata | Sampling default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `temperature` | `tmp_surface` | `C` | `-35..50` | `-35..50` | `0.25 C common range; 0.5 C tails` | `-128` | global banded |
| `apparent_temperature` | `aptmp_surface` | `C` | `-35..50` | `-35..50` | `0.25 C common range; 0.5 C tails` | `-128` | global banded |
| `dew_point` | `dewpoint_surface` | `C` | `-60..40` | `-63.5..63.5` | `0.5 C` | `-128` | global banded |
| `relative_humidity` | `rh_surface` | `%` | `0..100` | finite clamp `0..100`; storage `-77..177` | `1%` | `-128` | global banded |
| `wind_speed` | `wind10m_uv` derived as speed | `m/s` | `0..60` | component finite clamp `-64..64` | `1 m/s` | none | global banded |
| `wind_gust` | `gust_surface` | `m/s` | `0..60` | finite clamp `0..60`; storage `0..127` | `0.5 m/s` | `-128` | global banded |
| `air_pressure` | `prmsl_msl` | `Pa` | `98000..103600` | finite clamp `94150..106850` | `50 Pa` | `-128` | global banded |
| `precipitation_rate` | `prate_surface` | `mm/hr` | `0..30` | finite clamp `0..38.1` | `0.15 mm/hr` | `-128` | global banded |
| `accumulated_precipitation` | `precip_total_surface` | `mm` | `0..254` | finite clamp `0..254` | `1 mm` | `-128` | global banded |
| `snow_depth` | `snow_depth_surface` | `m` | `0..3` | finite clamp `0..3` | `~0.011811 m` | `-128` | global banded |
| `cloud_layers` | `cloud_layers` coverage field | `%` | `0..100` | finite clamp `0..100`; storage `-508..508` | `4%` | `-128` | global banded coverage; dedicated renderer |
| `cloud_cover` | `tcdc` | `%` | `0..100` | finite clamp `0..100`; storage `-508..508` | `4%` | `-128` | global banded |
| `visibility` | `visibility_surface` | `m` | `0..50000` | finite clamp `0..50800` | `200 m` | `-128` | global banded |
| `freezing_level` | `freezing_level` | `m` | `0..8000` | finite clamp `0..8128` | `32 m` | `-128` | global banded |
| `precipitable_water` | `precipitable_water` | `mm` | `0..80` | finite clamp `0..81.28` | `0.32 mm` | `-128` | global banded |
| `composite_reflectivity` | `refc_entire_atmosphere` | `dBZ` | `0..75` | finite clamp `0..75`; storage `-32..95` | `0.5 dBZ` | `-128` | global banded |
| `cape` | `cape_index` | `J/kg` | `0..5000` | finite clamp `0..5080` | `20 J/kg` | `-128` | global banded |
| `cin` | `cin_index` | `J/kg` | `0..500` | finite clamp `0..508` | `2 J/kg` | `-128` | global banded |

## Layer Requirements

### Temperature

Applies to `temperature` and `apparent_temperature`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `C` |
| Display range | `-35..50 C` |
| Required encoded range | `-35..50 C` |
| Precision | `<=0.5 C`; current piecewise encoding with `0.25 C` common-range precision is accepted |
| Exact boundaries | `-35 C`, `0 C`, `50 C` |
| Domain thresholds | `0 C` freezing; display min and max |
| Nodata policy | Expected-complete with sentinel retained |
| Invalid values | Non-finite values become nodata |
| Render behavior | Clamp colors to `-35..50 C`; probe labels show decoded `C` converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

Notes:

- Temperature is the most important scalar encoding. Keep the hand-rolled
  temperature ETL encoding and intentionally clip finite values to
  `-35..50 C`; temperature does not need overrange preservation in v1.
- `temperature` and `apparent_temperature` should normally have complete global
  grids. Any nodata should be treated as source or ETL quality fallout.

### Dew Point

Applies to `dew_point`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `C` |
| Display range | `-60..40 C` |
| Required encoded range | At least `-60..40 C`; current overrange `-63.5..63.5 C` is acceptable |
| Precision | `<=0.5 C` |
| Exact boundaries | `-60 C`, `0 C`, `40 C` |
| Domain thresholds | `-20 C`, `-10 C`, `10 C`, `16 C`, `18 C`, `21 C`, `24 C`, `27 C` |
| Nodata policy | Sentinel retained; expected mostly complete |
| Invalid values | Non-finite values become nodata |
| Render behavior | Clamp colors to `-60..40 C`; probe labels show decoded `C` converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

### Percent Fields

Applies to `relative_humidity`, `cloud_cover`, and `cloud_layers`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `%` |
| Display range | `0..100%` |
| Required encoded range | `0..100%` natural range |
| Relative humidity precision | `<=1%` |
| Cloud-cover precision | `<=1%` for `cloud_cover` / `tcdc` |
| Cloud component precision | `<=2%` for low, middle, and high cloud components |
| Exact boundaries | `0%`, `100%` |
| Domain thresholds | `10%`, `25%`, `50%`, `75%`, `90%` |
| Nodata policy | Expected-complete with sentinel retained |
| Invalid values | Non-finite values become nodata; finite out-of-range values clamp to `0..100%` before encoding |
| Render behavior | Clamp colors and derived cloud coverage to `0..100%` |
| Sampling | Global setting defaulted to banded for field/coverage color |
| Status | Draft accepted for encoding audit |

Notes:

- `cloud_layers` derives coverage from low, middle, and high components. If one
  component is nodata, coverage may derive from the remaining valid components.
  If all components are nodata, coverage is nodata.
- Cloud percentage artifacts should prioritize visualization/probe compactness.
  `cloud_layers` targets `2%` component precision; `tcdc` targets `1%`
  scalar precision.
- Natural bounded percent fields should not show impossible probe values. ETL
  should clamp finite percent inputs to `0..100%` before encoding.

### Wind

Applies to `wind_speed` and `wind_gust`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `m/s` |
| Speed display range | `0..60 m/s` |
| Required speed range | `0..60 m/s` |
| Required vector component range | At least `-60..60 m/s` for `u` and `v` |
| Precision | `<=1 m/s` |
| Exact boundaries | `0 m/s` calm; display max `60 m/s` for speed and gust |
| Domain thresholds | `5 m/s`, `10 m/s`, `15 m/s`, `17 m/s`, `25 m/s`, `33 m/s`, `50 m/s`, `60 m/s` |
| Nodata policy | `wind10m_uv` is expected-complete with no nodata sentinel; `wind_gust` keeps sentinel support |
| Invalid values | If either `wind10m_uv` component is non-finite for a cell, encode both `u` and `v` as `0 m/s`; non-finite gust values become nodata |
| Render behavior | Clamp speed colors to `0..60 m/s`; probe labels show decoded speed converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted; ongoing audits should verify the expected-complete `wind10m_uv` assumption |

Notes:

- `wind_speed` is frontend-derived from `wind10m_uv` using
  `sqrt(u^2 + v^2)`.
- `wind10m_uv` intentionally declares no nodata sentinel for v1. Upstream/ETL
  should be treated as expected to provide complete finite `u` and `v` grids.
- As a safety fallback, if either `u` or `v` is non-finite for a cell, ETL
  should encode both components as `0 m/s`. This is acceptable for a
  visualization product, but any occurrence should still be treated as
  data-quality fallout.

### Air Pressure

Applies to `air_pressure` and the pressure contour overlay.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `Pa` |
| Display range | `98000..103600 Pa` |
| Required encoded range | Finite clamp `94150..106850 Pa`; covers display range with overrange for deeper lows and stronger highs |
| Precision | `<=50 Pa` |
| Exact boundaries | Display bounds `98000 Pa`, `103600 Pa`; `400 Pa` contour levels in display range |
| Domain thresholds | `101325 Pa` standard pressure within half quantum; every `400 Pa` contour interval in display range exact |
| Nodata policy | Sentinel retained; expected mostly complete |
| Invalid values | Non-finite values become nodata |
| Render behavior | Clamp colors to display range; contour overlay keeps `400 Pa` interval behavior |
| Sampling | Global setting defaulted to banded for filled field |
| Status | Draft accepted for encoding audit |

### Precipitation Rate

Applies to `precipitation_rate`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `mm/hr` liquid-water equivalent |
| Display range | `0..30 mm/hr` |
| Required encoded range | `0..30 mm/hr` display support plus current `0..38.1 mm/hr` useful overrange |
| Precision | `<=0.15 mm/hr` |
| Exact boundaries | `0 mm/hr`, `30 mm/hr` |
| Domain thresholds | `0.15`, `0.3`, `0.75`, `1.5`, `3`, `7.5`, `12`, `25`, `30 mm/hr` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values become nodata; negative finite rates clamp to zero |
| Render behavior | Clamp colors to `0..30 mm/hr`; probe labels show decoded rate converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted; current `38.1 mm/hr` max is close enough to the about-`40 mm/hr` overrange target |

Notes:

- Source transform converts `kg/m^2/s` to `mm/hr`.
- Optional precipitation-type overlays are separate from base precipitation
  intensity requirements.

### Run-Total Precipitation

Applies to `accumulated_precipitation`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `mm` |
| Display range | `0..254 mm` |
| Required encoded range | `0..254 mm` |
| Precision | `<=1 mm` |
| Exact boundaries | `0 mm`, `254 mm` |
| Domain thresholds | `1`, `5`, `10`, `25`, `50`, `100`, `150`, `250 mm` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values become nodata; negative finite totals clamp to zero |
| Render behavior | Clamp colors to `0..254 mm`; probe labels show decoded total converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

Notes:

- This is run-total precipitation since model reference time, not a fixed
  rolling accumulation window.

### Snow Depth

Applies to `snow_depth`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `m` |
| Display range | `0..3 m` |
| Required encoded range | `0..3 m` |
| Precision | `<=0.012 m`; current `3/254 m` quantum uses the full int8 range |
| Exact boundaries | `0 m`, `3 m` |
| Domain thresholds | `0.02`, `0.05`, `0.1`, `0.2`, `0.5`, `1`, `2`, `3 m` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values and source nodata become artifact nodata before finite clamp; negative finite depths clamp to zero |
| Render behavior | Clamp colors to `0..3 m`; probe labels show decoded depth converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

Notes:

- GFS `SNOD` reports source nodata such as `9999` over open water; ETL must
  preserve that as artifact nodata rather than clamping it to max depth.

### Visibility

Applies to `visibility`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `m` |
| Display range | `0..50000 m` |
| Required encoded range | `0..50000 m`; current `0..50800 m` overrange is acceptable |
| Precision | `<=200 m` |
| Exact boundaries | `0 m`, `50000 m` |
| Domain thresholds | `500`, `1000`, `1600`, `5000`, `10000`, `20000 m` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values become nodata; negative finite visibility clamps to zero |
| Render behavior | Clamp colors to `0..50000 m`; probe labels show decoded visibility converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

### Freezing Level

Applies to `freezing_level`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `m` |
| Display range | `0..8000 m` |
| Required encoded range | `0..8000 m`; current `0..8128 m` overrange is acceptable |
| Precision | `<=32 m` |
| Exact boundaries | `0 m`, `8000 m` |
| Domain thresholds | `500`, `1000`, `1500`, `2500`, `3500`, `5000`, `6500 m` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values become nodata; negative finite heights clamp to zero |
| Render behavior | Clamp colors to `0..8000 m`; probe labels show decoded height converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

### Precipitable Water

Applies to `precipitable_water`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `mm` |
| Display range | `0..80 mm` |
| Required encoded range | `0..80 mm`; current `0..81.28 mm` overrange is acceptable |
| Precision | `<=0.32 mm` |
| Exact boundaries | `0 mm`, `80 mm` |
| Domain thresholds | `10`, `20`, `30`, `40`, `50`, `65 mm` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values become nodata; negative finite water depth clamps to zero |
| Render behavior | Clamp colors to `0..80 mm`; probe labels show decoded water depth converted by unit behavior |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

### Composite Reflectivity

Applies to `composite_reflectivity`.

| Requirement | V1 target |
| --- | --- |
| Stored unit | `dBZ` |
| Display range | `0..75 dBZ` |
| Required encoded range | Finite clamp `0..75 dBZ`; storage range remains `-32..95 dBZ` |
| Precision | `<=0.5 dBZ` |
| Exact boundaries | `0 dBZ`, `75 dBZ` |
| Domain thresholds | `5`, `10`, `20`, `30`, `40`, `50`, `60`, `70 dBZ` |
| Nodata policy | Sentinel retained |
| Invalid values | Non-finite values become nodata |
| Render behavior | Clamp colors to `0..75 dBZ`; probe labels show decoded reflectivity |
| Sampling | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit |

Notes:

- This is forecast model composite reflectivity, not observed radar.

### CAPE And CIN

Applies to `cape` and `cin`.

| Requirement | `cape` V1 target | `cin` V1 target |
| --- | --- | --- |
| Stored unit | `J/kg` | `J/kg` |
| Display range | `0..5000 J/kg` | `0..500 J/kg` |
| Required encoded range | `0..5000 J/kg`; current `0..5080 J/kg` overrange is acceptable | `0..500 J/kg`; current `0..508 J/kg` overrange is acceptable |
| Precision | `<=20 J/kg` | `<=2 J/kg` |
| Exact boundaries | `0`, `5000 J/kg` | `0`, `500 J/kg` |
| Domain thresholds | `250`, `500`, `1000`, `1500`, `2500`, `3500 J/kg` | `25`, `50`, `100`, `200`, `300 J/kg` |
| Nodata policy | Sentinel retained | Sentinel retained |
| Invalid values | Non-finite values become nodata; negative finite values clamp to zero | Non-finite values become nodata; source transform stores positive magnitude |
| Render behavior | Clamp colors to `0..5000 J/kg` | Clamp colors to `0..500 J/kg` |
| Sampling | Global setting defaulted to banded | Global setting defaulted to banded |
| Status | Draft accepted for encoding audit | Draft accepted for encoding audit |

Notes:

- `cin` uses positive cap-strength magnitude in the frontend. The ETL source
  transform converts signed CIN to magnitude.

## Encoding Decisions And Follow-Up

These are settled v1 decisions and remaining checks for the artifact encoding
correctness audit.

| Area | Decision / follow-up |
| --- | --- |
| `wind10m_uv` nodata | Accept no nodata sentinel for v1. Treat `u` and `v` as expected-complete finite grids. If either component is non-finite for a cell, encode both components as `0 m/s` as a visualization safety fallback, and treat any occurrence as data-quality fallout. |
| Gust encoding id | Encoding id is `gust_surface_i8_0p5ms_v1`, matching the configured `0.5 m/s` scale. |
| Total cloud-cover encoding | Total cloud cover uses `tcdc_i8_4pct_v1` with `4%` precision. |
| ETL finite clamp path | Bounded linear encodings use `encoding.finite_value_range` before quantization; non-finite values still follow each artifact's nodata or fallback policy. |
| Natural bounded fields | Percent, precipitation, snow, visibility, freezing level, precipitable water, CAPE, and CIN use finite clamps before encoding. Renderer clamps remain as a second line of defense. |
| `cloud_layers` component range | Low, middle, and high cloud components clamp finite values to `0..100%` before encoding. Keep `4%` component precision. |
| `precipitation_rate` overrange | Current encoding reaches `38.1 mm/hr`; this is accepted as close enough to the about-`40 mm/hr` useful overrange target. |
| Temperature overrange | Temperature and apparent temperature intentionally clip finite values to `-35..50 C`. No temperature overrange preservation is required in v1. |
| Sampling mode | Keep sampling as a global rendering setting and keep the default as banded. Do not introduce per-layer sampling defaults in v1. |
| Boundary correctness tests | Add exact-boundary tests around display bounds, natural bounds, and palette thresholds during the scalar palette and boundary audit. |

## Acceptance Checklist

- Every field-rendered layer in `config/forecast_catalog.json` appears in the
  inventory table.
- Every source artifact named in the inventory exists in
  `config/pipeline/base.json`.
- Current encoding range and quantum are recorded as facts, separate from v1
  targets.
- Settled encoding decisions and remaining checks are recorded explicitly.
- Accepted artifact encoding decisions should stay synchronized with
  `forecast-artifact-registry.md`; user-facing display decisions should later
  be copied into `forecast-layer-registry.md` as appropriate.
