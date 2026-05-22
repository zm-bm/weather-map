# Forecast Catalog Candidates

Last updated: 2026-05-21

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

Release tracks:

- `V1 stabilization`: fix or simplify currently exposed forecast behavior, or
  use current artifacts to reduce confusing user-facing choices.
- `Post-V1 backlog`: defer nice-to-have layers, model expansion, advanced
  severe weather, aviation-specific views, and external sources until after v1
  is stable.

## V1 Stabilization Queue

These are the remaining catalog decisions or follow-ups to resolve before a
stable v1. They either polish implemented behavior or simplify exposed choices
without expanding the model/source surface.

| Item | Type | Group | Source or recipe | Model support | V1 decision |
| --- | --- | --- | --- | --- | --- |
| `precipitation_rate` precipitation type overlay | Implemented layer follow-up | `precipitation` | Optional renderer support artifact `precip_type_surface`. | GFS/ICON optional overlay support. | Add legend/support UI that explains snowflake and winter-mix ice-dash symbols. Keep `precip_type_surface` non-selectable; it is renderer support for `precipitation_rate`, not its own catalog layer. |
| `accumulated_precipitation` | Implemented layer catalog decision | `precipitation` | Existing direct scalar from `precip_total_surface`. | ICON current; GFS currently unavailable in the workload. | Keep the current registry behavior as-is for v1. It remains selectable; fixed-window accumulation layers are deferred. |

## Current Groups

| Group id | Label | Current layers |
| --- | --- | --- |
| `temperature` | Temperature | `temperature`, `apparent_temperature`, `dew_point`, `relative_humidity` |
| `wind_pressure` | Wind & Pressure | `wind_speed`, `wind_gust`, `air_pressure` |
| `precipitation` | Precipitation | `precipitation_rate`, `accumulated_precipitation`, `precipitable_water`, `snow_depth`, `freezing_level` |
| `clouds_visibility` | Clouds & Visibility | `cloud_layers`, `cloud_cover`, `visibility` |
| `radar_storms` | Radar & Storms | `composite_reflectivity`, `cape`, `cin` |

## Post-V1 Catalog Backlog

These candidates remain useful, but are not required for a stable v1.

### Current-Artifact Candidates

These use current artifacts or fit the current GFS/ICON forecast scope, but are
deferred because they are not essential to the v1 product surface.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Deferral reason |
| --- | --- | --- | --- | --- | --- |
| `wind_direction` | Wind Direction | `wind_pressure` | Derived degrees from `wind10m_uv`. | GFS/ICON current. | Useful, but not needed for stable v1 with `wind_speed`, `wind_gust`, and the `wind` particle layer already present. May work better as readout, arrows, barbs, or a wind render mode than as a filled scalar layer. |
| `fog_low_visibility` | Fog / Low Visibility | `clouds_visibility` | Emphasis recipe from `visibility_surface`; optionally combine with low cloud or ceiling later. | GFS current; ICON needs visibility or an equivalent field. | Raw `visibility` already exists; defer a hazard-emphasis recipe, especially while ICON lacks visibility. This should not duplicate raw `visibility`, `cloud_layers`, or `cloud_ceiling`. |
| `thunderstorm_overlay` | Thunderstorm Overlay | `precipitation` or `radar_storms` | Optional overlay or storm-context rendering from `thunderstorm_mask`. | ICON current; GFS unavailable unless a future explicit source is chosen. | Defer ICON-only thunderstorm rendering until precipitation-vs-storm context is worth solving. Do not fake GFS thunder with CAPE, reflectivity, or other proxies unless that tradeoff is explicitly chosen. |

### Forecast-Model Expansion

These remain GFS/ICON oriented, but need new artifacts, source confirmation, or
more catalog design before implementation.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Deferral reason |
| --- | --- | --- | --- | --- | --- |
| `precip_accum_1h`, `precip_accum_3h`, `precip_accum_6h`, `precip_accum_12h`, `precip_accum_24h` | 1h/3h/6h/12h/24h Precipitation | `precipitation` | Fixed-window accumulation artifacts or derived windows from source accumulation fields. | GFS/ICON target after upstream cadence and derivation are confirmed. | Requires fixed-window accumulation semantics and artifacts; not needed for stable v1. Do not overload `accumulated_precipitation`; each layer needs explicit window semantics. |
| `snowfall_accumulation` | Snowfall Accumulation | `precipitation` | Forecast new-snow accumulation artifact or derived snowfall accumulation. | GFS/ICON target after source fields are confirmed. | Needs new snowfall accumulation source or derivation; defer beyond core precipitation. Different from `snow_depth`, which is existing snow on the ground. |
| `jet_stream` | Jet Stream | `wind_pressure` | Upper-level wind speed derived from `wind250mb_uv`, `wind300mb_uv`, or the chosen standard level. | GFS/ICON target after upper-air wind artifacts exist. | Upper-air expansion, not core v1. User-facing label should be `Jet Stream`, not a raw pressure-level field name. |
| `geopotential_height_500mb` | Upper-Level Pattern / 500mb Heights | `wind_pressure` | Direct 500mb geopotential height scalar such as `hgt_500mb`. | GFS/ICON target after upper-air height artifacts exist. | Upper-air/synoptic expansion, not core v1. Classic trough/ridge and steering-pattern layer. |
| `upper_air_standard_levels` | Upper-Air Layers | Varies; likely `wind_pressure` first | Family covering standard pressure-level temperature, wind, height, humidity, and vorticity. | GFS/ICON target after exact levels and artifact ids are chosen. | Family placeholder; defer until concrete layer ids and artifacts are chosen. |
| `cloud_ceiling` | Cloud Ceiling | `clouds_visibility` | Lowest significant cloud ceiling or cloud-base height artifact. | GFS/ICON target if native or equivalent fields are available. | Separate aviation/height-style layer. Pairs with visibility and future fog views, but should not be conflated with the model-derived `cloud_layers` composite. |
| `storm_relative_helicity` | Storm Helicity | `radar_storms` | Storm-relative helicity scalar such as `srh_0_3km`. | GFS/ICON target if source fields are available. | Advanced severe-weather context; defer beyond core storm layers. |

### Radar And External Sources

Observed radar remains important, but it should not block the GFS/ICON catalog
cleanup. Keep forecast model output clearly separate from observed radar.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Deferral reason |
| --- | --- | --- | --- | --- | --- |
| `nexrad_reflectivity` | NEXRAD Radar / Observed Radar | `radar_storms` | External observed radar raster tiles or equivalent radar product. | External NEXRAD source, not GFS/ICON/HRRR model output. | External observed radar source with separate time semantics. Uses recent observed time, not forecast time. UI labels should make the observed source obvious. |

### External Product Families

These need source, product, interaction, and grouping decisions before becoming
specific catalog entries.

| Candidate id | UI label | Group | Source or recipe | Current/future model support | Deferral reason |
| --- | --- | --- | --- | --- | --- |
| `satellite` | Satellite | `clouds_visibility` or future external group | External satellite raster or derived cloud product. | External source. | External product family; choose a specific product family before assigning final layer ids. Keep this distinct from the model-derived `cloud_layers` composite. |
| `air_quality` | Air Quality | Future group likely needed | External pollutant or smoke/air-quality product. | External source. | External source and likely future group; define pollutant scope before adding user-facing layers. |
| `watches_warnings` | Watches & Warnings | `radar_storms` or future alerts group | External alert polygons and metadata. | External source. | External alert polygons with distinct interaction and time behavior; not a normal scalar field. |
| `observed_lightning` | Lightning | `radar_storms` | External recent observed lightning points or tiles. | External source. | External observed-recent source with likely observed-recent timeline semantics. |
| `waves` | Waves | Future marine group likely needed | NOAA wave source or equivalent marine forecast product. | External source. | Future marine source and group; add only after a suitable source and artifact contract are identified. |

## Promotion Checklist

Before moving a candidate into `forecast-layer-registry.md`:

1. Settle the user-facing layer id, label, group, and time semantics.
2. Define whether it is a scalar field, categorical field, particle layer,
   overlay, or external tile/source.
3. Confirm artifact ids and model support in the artifact and model mapping
   docs.
4. Decide display metadata after catalog identity is stable; detailed palette
   review remains separate.
