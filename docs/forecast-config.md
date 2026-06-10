# Forecast Config

Weather Map forecast products are defined by two focused JSON files:

- `config/pipeline.json` is the ETL production contract. It defines what
  datasets can produce, how frame workers select source fields, and what
  artifacts are published.
- `config/catalog.json` is the product/frontend presentation contract. It
  defines which layers users can see, how those layers are grouped, and which
  artifact bands each layer loads.

Product config loading binds the two files together. The loader parses
`pipeline.json`, projects the ETL-relevant source requirements from
`catalog.json`, and validates that the catalog only asks for artifacts and
components the pipeline can publish.

## Pipeline Config

`pipeline.json` has three main sections:

| Section | Owner | Purpose |
| --- | --- | --- |
| `version` | ETL config | Config document version. |
| `artifact_catalog` | ETL artifact contract | Artifact ids, kind, units, transforms, encoding, and component order. |
| `datasets` | ETL workload contract | Source settings, frame range, workload artifacts, and dataset-specific selectors or derivations. |

Each artifact in `artifact_catalog` describes the payload shape independent of
any source model. Important fields are:

- `kind`: `scalar` for one `value` component, `vector` for named multi-band
  artifacts such as `u` / `v`.
- `parameter`, `level`, and `units`: semantic metadata copied into manifests.
- `source_transform`: normalization applied before encoding.
- `encoding`: byte representation and nodata/range behavior.
- `components`: ordered component ids. Catalog bands must match these ids.

Each dataset under `datasets` defines:

- `source`: source type, grid id, and source-specific runtime settings.
- `workload`: forecast-hour frame range and optional artifact subset.
- `artifacts`: dataset-specific component selectors, temporal metadata,
  derivations, and grid transforms.

Direct dataset artifacts put source selectors on output components. Derived
artifacts put selectors under `derivation.inputs`; output components for
derived artifacts do not carry source selectors.

## Catalog Config

`catalog.json` is frontend-facing. ETL only reads the subset needed to prove
that product layers can be backed by published artifacts.

| Section | Purpose |
| --- | --- |
| `rasterLayerGroups` | Browse groups and default raster-layer ordering. |
| `rasterLayers` | User-selectable filled raster layers and their source recipes. |
| `overlayLayers` | Optional layer-attached overlays, such as precipitation type patterns. |
| `contourLayers` | Map-option contour renderers backed by artifact bands. |
| `particleLayers` | Particle renderers backed by vector artifact bands. |

Layer source recipes use `source.artifactId` plus ordered `source.bands[]`.
Frontend display metadata such as labels, palettes, ranges, and units is owned
by frontend display profiles, not by the ETL artifact contract.

## Agreement Rules

Product config loading validates the following cross-file rules:

- Every catalog `artifactId` must exist in `pipeline.json.artifact_catalog`.
- Every catalog band id must match the artifact component ids exactly.
- Required raster-layer artifacts must be included in each dataset workload for
  the layer to be available for that dataset.
- Overlay references must point to catalog overlay ids.
- Optional overlays may be unavailable without making the parent raster layer
  unavailable.
- Manifest index generation and status generation use the same product config,
  so public manifests and `manifests/index.json` are checked against the same
  catalog requirements.

## Current Product Summary

Statuses:

- `native`: the dataset publishes the catalog artifact directly from source
  fields.
- `frontend-derived`: the frontend computes the display value from published
  artifact bands.
- `etl-derived`: ETL derives the artifact before publication.
- `unavailable`: the dataset does not currently publish the required artifact.

| Catalog id | Kind | Artifact / bands | GFS | ICON | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | raster | `tmp_surface` / `value` | `native` | `native` | Near-surface screen temperature. |
| `apparent_temperature` | raster | `aptmp_surface` / `value` | `native` | `unavailable` | ICON does not publish apparent temperature in the current workload. |
| `dew_point` | raster | `dewpoint_surface` / `value` | `native` | `native` | Near-surface dew point. |
| `relative_humidity` | raster | `rh_surface` / `value` | `native` | `native` | Near-surface relative humidity. |
| `wind_speed` | raster | `wind10m_uv` / `u`, `v` | `frontend-derived` | `frontend-derived` | Frontend renders and probes speed magnitude from the vector bands. |
| `wind_gust` | raster | `gust_surface` / `value` | `native` | `native` | Near-surface gust speed. |
| `air_pressure` | raster | `prmsl_msl` / `value` | `native` | `native` | Mean sea-level pressure; ICON publishes this artifact on a downsampled grid. |
| `precipitation_rate` | raster | `prate_surface` / `value` | `native` | `etl-derived` | May use optional `precipitation_type` overlay when available. |
| `accumulated_precipitation` | raster | `precip_total_surface` / `value` | `etl-derived` | `native` | Run-total precipitation since model reference time. |
| `snow_depth` | raster | `snow_depth_surface` / `value` | `native` | `native` | Snow depth on the ground. |
| `cloud_layers` | raster | `cloud_layers` / `low`, `middle`, `high` | `native` | `native` | Custom cloud renderer consumes ordered low/middle/high bands. |
| `cloud_cover` | raster | `tcdc` / `value` | `native` | `native` | Total cloud cover. |
| `visibility` | raster | `visibility_surface` / `value` | `native` | `unavailable` | ICON does not publish this artifact in the current workload. |
| `freezing_level` | raster | `freezing_level` / `value` | `native` | `native` | Height of the 0C isotherm. |
| `precipitable_water` | raster | `precipitable_water` / `value` | `native` | `native` | Column-integrated water vapor. |
| `composite_reflectivity` | raster | `refc_entire_atmosphere` / `value` | `native` | `unavailable` | Forecast simulated radar, not observed radar. |
| `cape` | raster | `cape_index` / `value` | `native` | `native` | Mixed-layer CAPE. |
| `cin` | raster | `cin_index` / `value` | `native` | `unavailable` | GFS-only in the current configured sources. |
| `precipitation_type` | overlay | `precip_type_surface` / `snow_frac`, `mix_frac` | `etl-derived` | `etl-derived` | Optional overlay for precipitation-rate rendering. |
| `pressure_contours` | contour | `prmsl_msl` / `value` | `native` | `native` | Toggleable mean-sea-level pressure contours. |
| `wind` | particle | `wind10m_uv` / `u`, `v` | `native` | `native` | Animated 10m wind particles. |

`pipeline.json` may also define supporting artifacts that are not exposed by
`catalog.json` yet. For example, `thunderstorm_mask` is currently configured
for ICON as future product support, not as a user-facing catalog layer.

## Special Semantics

### `wind10m_uv`

`wind10m_uv` is a vector artifact with ordered `u` and `v` components. The
`wind_speed` raster layer computes speed magnitude in the frontend, while the
`wind` particle layer uses the vector components directly.

### `cloud_layers`

`cloud_layers` packs low, middle, and high cloud-cover components. The frontend
cloud renderer combines those components into cloud structure and opacity; it
is not a simple single-band scalar layer.

### `precip_type_surface`

`precip_type_surface` stores soft snow and winter-mix fractions. It is an
optional overlay contract for `precipitation_rate`, so precipitation intensity
can still render when the overlay artifact is missing.

### `precip_total_surface`

`precip_total_surface` is run-total precipitation since model reference time.
GFS derives it from run-total `APCP` and synthesizes zero at `f000`; ICON uses
the native `tot_prec` accumulation.

### ICON Precipitation Rate

ICON precipitation rate is derived from adjacent `tot_prec` accumulation
frames, then normalized to `mm/hr`. The first configured previous value is
treated as zero.

## Update Workflow

Use this order when changing forecast products:

1. Add or change ETL artifacts in `config/pipeline.json`.
   - Update `artifact_catalog` for new artifact ids, components, units,
     transforms, and encoding.
   - Update each dataset's `artifacts` and `workload` when that dataset should
     publish the artifact.
2. Add or change frontend product layers in `config/catalog.json`.
   - Add raster, overlay, contour, or particle source recipes with artifact id
     and ordered bands.
   - Keep frontend-only labels, display profiles, palettes, and grouping in the
     catalog/frontend layer where they belong.
3. Check product agreement.
   - Catalog artifact ids and bands must match pipeline artifact components.
   - Required raster artifacts must be producible by every dataset that should
     advertise the layer.
   - Optional overlays can be added without blocking the parent layer.
4. Run focused validation before publishing new artifacts.

```bash
cd etl && ../.venv/bin/python -m pytest tests/config tests/state/manifest
cd etl && ../.venv/bin/ruff check weather_etl/config tests/config
```

