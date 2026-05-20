# Forecast Catalog Candidates

Last updated: 2026-05-19

This document is the working backlog for unimplemented or unsettled
user-facing forecast catalog choices. Use it to settle catalog identity before
polishing implementation details.

Scope rules:

1. Implemented layers live in `forecast-layer-registry.md`.
2. ETL artifact shape and encoding live in `forecast-artifact-registry.md`.
3. Per-model upstream mapping lives in `forecast-model-mapping.md`.
4. Scalar palette review, color-stop correctness, and exact boundary tests are
   separate from this catalog backlog.
5. GFS and ICON are the near-term forecast models. HRRR is future work and
   should not block GFS/ICON catalog additions. NEXRAD remains planned, but it
   should not make radar the immediate catalog priority.

## Current Groups

| Group id | Label | Current layers |
| --- | --- | --- |
| `temperature` | Temperature | `temperature`, `apparent_temperature`, `dew_point`, `relative_humidity` |
| `wind_pressure` | Wind & Pressure | `wind_speed`, `wind_gust`, `air_pressure` |
| `precipitation` | Precipitation | `precipitation_rate`, `accumulated_precipitation`, `precipitable_water`, `snow_depth`, `freezing_level` |
| `clouds_visibility` | Clouds & Visibility | `cloud_cover`, `low_cloud_cover`, `middle_cloud_cover`, `high_cloud_cover`, `visibility` |
| `radar_storms` | Radar & Storms | `composite_reflectivity`, `cape`, `cin` |

## GFS/ICON-First Candidates

These are the best candidates to settle first because they use current artifacts
or fit the current GFS/ICON forecast scope.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `precipitation_type` | Precipitation Type | `precipitation` | Future glyph overlay/render mode using soft `precip_type_surface` fractions. | GFS/ICON staged via `snow_frac`/`mix_frac`. | Settle now | Current `precipitation_rate` remains a simple intensity layer. Decide whether type appears as an overlay toggle, render mode, or separate layer. |
| `wind_direction` | Wind Direction | `wind_pressure` | Derived degrees from `wind10m_uv`. | GFS/ICON current. | Settle now | May work better as readout, arrows, barbs, or a wind render mode than as a filled scalar layer. |
| `pressure_contours` | Pressure Contours | `wind_pressure` | Contour overlay from `prmsl_msl`. | GFS/ICON current. | Settle now | Treat as an overlay/control or layer decision. Source is mean sea-level pressure. |
| `fog_low_visibility` | Fog / Low Visibility | `clouds_visibility` | Emphasis recipe from `visibility_surface`; optionally combine with low cloud or ceiling later. | GFS current; ICON needs visibility or an equivalent field. | Settle now | This should emphasize meaningful low-visibility conditions, not duplicate the raw `visibility` layer. |
| `accumulated_precipitation` | Run-Total Precipitation | `precipitation` | Existing direct scalar from `precip_total_surface`. | ICON current; GFS currently unavailable in the workload. | Settle now | Decide whether to keep this as an explicit run-total layer after fixed-window accumulations exist. If retained, label and time semantics must clearly distinguish it from 1h/3h/24h totals. |

## Next Forecast-Model Expansion

These remain GFS/ICON oriented, but need new artifacts, source confirmation, or
more catalog design before implementation.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `precip_accum_1h`, `precip_accum_3h`, `precip_accum_6h`, `precip_accum_12h`, `precip_accum_24h` | 1h/3h/6h/12h/24h Precipitation | `precipitation` | Fixed-window accumulation artifacts or derived windows from source accumulation fields. | GFS/ICON target after upstream cadence and derivation are confirmed. | Next | Do not overload `accumulated_precipitation`; each layer needs explicit window semantics. |
| `snowfall_accumulation` | Snowfall Accumulation | `precipitation` | Forecast new-snow accumulation artifact or derived snowfall accumulation. | GFS/ICON target after source fields are confirmed. | Next | Different from `snow_depth`, which is existing snow on the ground. |
| `jet_stream` | Jet Stream | `wind_pressure` | Upper-level wind speed derived from `wind250mb_uv`, `wind300mb_uv`, or the chosen standard level. | GFS/ICON target after upper-air wind artifacts exist. | Next | User-facing label should be `Jet Stream`, not a raw pressure-level field name. |
| `geopotential_height_500mb` | Upper-Level Pattern / 500mb Heights | `wind_pressure` | Direct 500mb geopotential height scalar such as `hgt_500mb`. | GFS/ICON target after upper-air height artifacts exist. | Next | Classic trough/ridge and steering-pattern layer. |
| `upper_air_standard_levels` | Upper-Air Layers | Varies; likely `wind_pressure` first | Family covering standard pressure-level temperature, wind, height, humidity, and vorticity. | GFS/ICON target after exact levels and artifact ids are chosen. | Next | This is a family placeholder. Settle concrete layer ids before implementation. |
| `cloud_ceiling` | Cloud Ceiling | `clouds_visibility` | Lowest significant cloud ceiling or cloud-base height artifact. | GFS/ICON target if native or equivalent fields are available. | Next | Pairs with visibility and future fog/aviation-style views. |
| `storm_relative_helicity` | Storm Helicity | `radar_storms` | Storm-relative helicity scalar such as `srh_0_3km`. | GFS/ICON target if source fields are available. | Next | More advanced severe-weather context; add after core precipitation and wind additions. |

## Later Radar And External Sources

Observed radar remains important, but it should not block the GFS/ICON catalog
cleanup. Keep forecast model output clearly separate from observed radar.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `nexrad_reflectivity` | NEXRAD Radar / Observed Radar | `radar_storms` | External observed radar raster tiles or equivalent radar product. | External NEXRAD source, not GFS/ICON/HRRR model output. | Later | Uses recent observed time, not forecast time. UI labels should make the observed source obvious. |

## Parking-Lot External Families

These need source, product, interaction, and grouping decisions before becoming
specific catalog entries.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `satellite` | Satellite | `clouds_visibility` or future external group | External satellite raster or derived cloud product. | External source. | Parking lot | Choose specific product family before assigning final layer ids. |
| `air_quality` | Air Quality | Future group likely needed | External pollutant or smoke/air-quality product. | External source. | Parking lot | Define pollutant scope before adding user-facing layers. |
| `watches_warnings` | Watches & Warnings | `radar_storms` or future alerts group | External alert polygons and metadata. | External source. | Parking lot | Not a normal scalar field; interaction and time behavior matter. |
| `observed_lightning` | Lightning | `radar_storms` | External recent observed lightning points or tiles. | External source. | Parking lot | Likely uses observed-recent timeline semantics. |
| `waves` | Waves | Future marine group likely needed | NOAA wave source or equivalent marine forecast product. | External source. | Parking lot | Add only after a suitable source and artifact contract are identified. |

## Promotion Checklist

Before moving a candidate into `forecast-layer-registry.md`:

1. Settle the user-facing layer id, label, group, and time semantics.
2. Define whether it is a scalar field, categorical field, particle layer,
   overlay, or external tile/source.
3. Confirm artifact ids and model support in the artifact and model mapping
   docs.
4. Decide display metadata after catalog identity is stable; detailed palette
   review remains separate.
