# Weather Map Terminology

Defines the shared semantic vocabulary for Weather Map.

Use this file to distinguish user-facing layer concepts from ETL artifacts,
forecast time concepts, renderer channels, and MapLibre implementation details.

## Layer Terms

- `forecast`: the app domain for manifests, time selection, layer selection,
  artifact loading, rendering, and probe display.
- `model`: a configured forecast source such as GFS or ICON. A model can have
  many cycles.
- `layer`: a user-facing forecast choice from the frontend catalog, such as
  Temperature, Wind Speed, or Precipitation Rate.
- `layer source`: a catalog recipe describing how a layer obtains data. A layer
  source may map directly to one artifact, derive a field in the frontend, or
  combine a base artifact with optional supporting artifacts.
- `particle layer`: a user-facing animated particle visualization choice,
  separate from field-rendered layers. The current particle layer is wind
  particles.
- `forecast catalog`: the frontend-owned list of layers, particle layers,
  groups, labels, palettes, display ranges, unit behavior, and source recipes.
- `palette` / `colortable`: a catalog-owned display mapping from scalar
  magnitude to color.

## Time Terms

- `cycle`: model run initialization timestamp, formatted as `YYYYMMDDHH`.
- `lead hour` / `hour token`: forecast offset from the cycle, formatted as
  `000`, `001`, `003`, etc.
- `valid time`: the actual UTC forecast time represented in the UI.
- `time slice`: one forecast cycle plus one lead hour. This is the preferred
  semantic term for one discrete forecast data time.
- `interpolation window`: the lower time slice, upper time slice, and
  interpolation mix used for continuous valid-time rendering.
- `frame`: legacy implementation term for one forecast data time. Prefer
  `time slice` in prose and new code, except for manifest `frames` payload refs
  where the published schema still uses that key.

## Artifact Terms

- `artifact catalog`: the ETL-owned config defining which artifacts the ETL
  produces. This is distinct from the frontend-owned forecast catalog.
- `artifact`: an ETL-produced payload advertised by the manifest, with decode
  metadata and time-slice references.
- `artifact payload`: the encoded binary bytes for one artifact at one time
  slice.
- `scalar artifact`: an artifact containing one gridded value per cell.
- `vector artifact`: an artifact containing paired vector components, currently
  `u/v` wind.
- `manifest`: the artifact availability and decode contract for a model run. It
  describes artifacts, grids, encodings, time slices, frame refs, and run
  identity; it does not define the user-facing layer taxonomy.
- `frame ref`: the manifest's published reference to an artifact payload. The
  manifest still uses `frames` as the wire key for these refs.

## Rendering Terms

- `field`: a renderable scalar grid for a selected layer at one time slice. A
  field may come from a scalar artifact or a derived vector recipe. Vector wind
  is not a field unless converted into scalar field data for a layer such as
  Wind Speed.
- `staged overlay artifact`: model data published for a future render overlay
  but not currently loaded with a field, such as `precip_type_surface`.
- `particle time-slice data`: decoded vector data prepared for the particle
  render channel at one time slice.
- `render channel`: a top-level Weather Map rendering surface, currently
  `field` and `particles`.
- `MapLibre layer`: a MapLibre style or custom-layer primitive. Do not use plain
  `layer` for this in app/domain docs.

## Interaction Terms

- `sync`: orchestration that turns current app state into loaded data, applied
  render channels, and published probe data.
- `forecast data`: the frontend pipeline that resolves selected layer, time,
  and particle choices into renderable field and particle data.
- `probe`: sampling the applied field at a map coordinate for labels and
  readouts.
