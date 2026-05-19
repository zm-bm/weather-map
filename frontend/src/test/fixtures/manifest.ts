import type {
  ActiveForecastRun,
  ArtifactId,
  ForecastModelId,
  ForecastTimeSpec,
  LatestForecastRun,
  Manifest,
  ManifestArtifactSpec,
  ScalarArtifactSpec,
  ScalarEncodingSpec,
  ScalarGridSpec,
  VectorArtifactId,
  VectorArtifactSpec,
  VectorEncodingSpec,
} from '../../forecast-manifest'
import {
  asArtifactId,
  asVectorArtifactId,
  FORECAST_MANIFEST_SCHEMA,
  FORECAST_MANIFEST_SCHEMA_VERSION,
  FORECAST_PAYLOAD_CONTRACT,
  activeForecastRunForModel,
} from '../../forecast-manifest'

export const FIXTURE_MODEL_ID = 'gfs'
export const FIXTURE_MODEL_LABEL = 'GFS'
export const FIXTURE_CYCLE = '2026041312'
export const FIXTURE_GENERATED_AT = '2026-04-13T12:00:00Z'
export const FIXTURE_REVISION = 'rev'
export const FIXTURE_HOUR_TOKEN = '000'
export const FIXTURE_GRID_ID = 'g0'
export const FIXTURE_SCALAR_ENCODING_ID = 'e0'
export const FIXTURE_VECTOR_ENCODING_ID = 'wind10m_uv_vector_i8_v1'
export const FIXTURE_SCALAR_ID = asArtifactId('tmp_surface')
export const FIXTURE_VECTOR_ID = asVectorArtifactId('wind10m_uv')
export const DEFAULT_FORECAST_HOURS = [FIXTURE_HOUR_TOKEN, '003']

export type ManifestFixtureOverrides = {
  model?: { id: ForecastModelId; label: string }
  run?: LatestForecastRun['run']
  times?: ForecastTimeSpec[]
  artifacts?: Record<string, ManifestArtifactSpec>
  layers?: Manifest['layers']
  cycle?: string
  generatedAt?: string
  revision?: string
  forecastHours?: string[]
  scalarArtifactIds?: string[]
  vectorArtifactIds?: string[]
}

export type ScalarArtifactFixtureOverrides = Partial<ScalarArtifactSpec> & {
  cycle?: string
  forecastHours?: string[]
  times?: ForecastTimeSpec[]
}

export type VectorArtifactFixtureOverrides = Partial<VectorArtifactSpec> & {
  cycle?: string
  forecastHours?: string[]
  times?: ForecastTimeSpec[]
}

function toArtifactIds<T>(
  values: string[],
  brand: (value: string) => T,
): T[] {
  return values.map(brand)
}

function toForecastValidAt(cycle: string, hourId: string): string {
  return new Date(
    Date.UTC(
      Number.parseInt(cycle.slice(0, 4), 10),
      Number.parseInt(cycle.slice(4, 6), 10) - 1,
      Number.parseInt(cycle.slice(6, 8), 10),
      Number.parseInt(cycle.slice(8, 10), 10) + Number.parseInt(hourId, 10),
    )
  ).toISOString()
}

export function createForecastTimesFixture(
  forecastHours: string[] = DEFAULT_FORECAST_HOURS,
  cycle = FIXTURE_CYCLE
): ForecastTimeSpec[] {
  return forecastHours.map((hourId) => ({
    id: hourId,
    leadHours: Number.parseInt(hourId, 10),
    validAt: toForecastValidAt(cycle, hourId),
  }))
}

export function createGridFixture(overrides: Partial<ScalarGridSpec> = {}): ScalarGridSpec {
  return {
    id: FIXTURE_GRID_ID,
    crs: 'EPSG:4326',
    nx: 2,
    ny: 2,
    lon0: -180,
    lat0: 90,
    dx: 0.25,
    dy: -0.25,
    origin: 'cell_center',
    layout: 'row_major',
    xWrap: 'repeat',
    yMode: 'clamp',
    ...overrides,
  }
}

export function createScalarEncodingFixture(overrides: Partial<ScalarEncodingSpec> = {}): ScalarEncodingSpec {
  return {
    id: FIXTURE_SCALAR_ENCODING_ID,
    format: 'linear-i16-v1',
    dtype: 'int16',
    byteOrder: 'little',
    nodata: -32768,
    scale: 0.01,
    offset: 0,
    decodeFormula: 'value = stored * scale + offset',
    ...overrides,
  } as ScalarEncodingSpec
}

export function createVectorEncodingFixture(overrides: Partial<VectorEncodingSpec> = {}): VectorEncodingSpec {
  return {
    id: FIXTURE_VECTOR_ENCODING_ID,
    format: 'linear-i8-v1',
    dtype: 'int8',
    byteOrder: 'none',
    scale: 0.5,
    offset: 0,
    decodeFormula: 'value = stored * scale + offset',
    ...overrides,
  }
}

function payloadByteLength(args: {
  grid: ScalarGridSpec
  components: readonly string[]
  dtype: ManifestArtifactSpec['encoding']['dtype']
}): number {
  const bytesPerValue = args.dtype === 'int16' ? 2 : 1
  return args.grid.nx * args.grid.ny * args.components.length * bytesPerValue
}

export function createScalarArtifactFixture(
  overrides: ScalarArtifactFixtureOverrides = {}
): ScalarArtifactSpec {
  const id = overrides.id ?? FIXTURE_SCALAR_ID
  const grid = overrides.grid ?? createGridFixture()
  const encoding = overrides.encoding ?? createScalarEncodingFixture()
  const components = overrides.components ?? ['value']

  return {
    id,
    kind: 'scalar',
    units: overrides.units ?? 'C',
    parameter: overrides.parameter ?? 'tmp',
    level: overrides.level ?? 'surface',
    components,
    grid,
    encoding,
    byteLength: overrides.byteLength ?? payloadByteLength({
      grid,
      components,
      dtype: encoding.dtype,
    }),
    temporalKind: overrides.temporalKind,
    sourceIntervalHours: overrides.sourceIntervalHours,
  }
}

export function createVectorArtifactFixture(
  overrides: VectorArtifactFixtureOverrides = {}
): VectorArtifactSpec {
  const id = overrides.id ?? FIXTURE_VECTOR_ID
  const grid = overrides.grid ?? createGridFixture()
  const encoding = overrides.encoding ?? createVectorEncodingFixture()
  const components = overrides.components ?? ['u', 'v']

  return {
    id,
    kind: 'vector',
    units: overrides.units ?? 'm/s',
    parameter: overrides.parameter ?? 'vector',
    level: overrides.level ?? '10m_above_ground',
    components,
    grid,
    encoding,
    byteLength: overrides.byteLength ?? payloadByteLength({
      grid,
      components,
      dtype: encoding.dtype,
    }),
    temporalKind: overrides.temporalKind,
    sourceIntervalHours: overrides.sourceIntervalHours,
  }
}

function artifactIdsByKind(
  artifacts: Record<string, ManifestArtifactSpec> | undefined,
  kind: ManifestArtifactSpec['kind']
): string[] {
  return Object.values(artifacts ?? {})
    .filter((artifact) => artifact.kind === kind)
    .map((artifact) => artifact.id)
}

function createManifestArtifacts(args: {
  scalarArtifactIds: ArtifactId[]
  vectorArtifactIds: VectorArtifactId[]
  overrides?: Record<string, ManifestArtifactSpec>
}): Record<string, ManifestArtifactSpec> {
  const manifestArtifacts: Record<string, ManifestArtifactSpec> = {}

  for (const artifactId of args.scalarArtifactIds) {
    const override = args.overrides?.[artifactId]
    manifestArtifacts[artifactId] = override
      ? retargetArtifactOverride(override, artifactId)
      : createScalarArtifactFixture({ id: artifactId })
  }

  for (const artifactId of args.vectorArtifactIds) {
    const override = args.overrides?.[artifactId]
    manifestArtifacts[artifactId] = override
      ? retargetArtifactOverride(override, artifactId)
      : createVectorArtifactFixture({ id: artifactId })
  }

  return manifestArtifacts
}

function retargetArtifactOverride(
  artifact: ManifestArtifactSpec,
  artifactId: ArtifactId
): ManifestArtifactSpec {
  return {
    ...artifact,
    id: artifactId,
  }
}

export function createLatestRunFixture(
  overrides: ManifestFixtureOverrides = {}
): LatestForecastRun {
  const cycle = overrides.cycle ?? overrides.run?.cycle ?? FIXTURE_CYCLE
  const generatedAt = overrides.generatedAt ?? overrides.run?.generatedAt ?? FIXTURE_GENERATED_AT
  const revision = overrides.revision ?? overrides.run?.revision ?? FIXTURE_REVISION
  const times = overrides.times ?? createForecastTimesFixture(
    overrides.forecastHours ?? DEFAULT_FORECAST_HOURS,
    cycle
  )
  const scalarArtifactIdValues = overrides.scalarArtifactIds ?? artifactIdsByKind(overrides.artifacts, 'scalar')
  const vectorArtifactIdValues = overrides.vectorArtifactIds ?? artifactIdsByKind(overrides.artifacts, 'vector')
  const defaultScalarArtifactIdValues = (
    overrides.scalarArtifactIds === undefined
    && overrides.artifacts === undefined
    && scalarArtifactIdValues.length === 0
  )
    ? [FIXTURE_SCALAR_ID]
    : scalarArtifactIdValues
  const defaultVectorArtifactIdValues = (
    overrides.vectorArtifactIds === undefined
    && overrides.artifacts === undefined
    && vectorArtifactIdValues.length === 0
  )
    ? [FIXTURE_VECTOR_ID]
    : vectorArtifactIdValues
  if (defaultScalarArtifactIdValues.length + defaultVectorArtifactIdValues.length < 1) {
    throw new Error('createManifestFixture requires at least one artifact id')
  }

  return {
    run: {
      cycle,
      generatedAt,
      revision,
    },
    times,
    artifacts: createManifestArtifacts({
      scalarArtifactIds: toArtifactIds(defaultScalarArtifactIdValues, asArtifactId),
      vectorArtifactIds: toArtifactIds(defaultVectorArtifactIdValues, asVectorArtifactId),
      overrides: overrides.artifacts,
    }),
  }
}

export function createManifestLayersFixture(
  artifacts: Record<string, ManifestArtifactSpec> = {},
  modelId: ForecastModelId = FIXTURE_MODEL_ID
): Manifest['layers'] {
  const has = (artifactId: string) => artifactId in artifacts
  const available = (requiredArtifacts: string[]) => createLayerModelAvailabilityFixture({ requiredArtifacts })
  const unavailable = (requiredArtifacts: string[]) => createLayerModelAvailabilityFixture({
    state: 'temporarily_unavailable',
    requiredArtifacts,
  })

  return {
    temperature: createManifestLayerFixture({
      [modelId]: has('tmp_surface') ? available(['tmp_surface']) : unavailable(['tmp_surface']),
    }),
    apparent_temperature: createManifestLayerFixture({
      [modelId]: has('aptmp_surface') ? available(['aptmp_surface']) : unavailable(['aptmp_surface']),
    }),
    dew_point: createManifestLayerFixture({
      [modelId]: has('dewpoint_surface') ? available(['dewpoint_surface']) : unavailable(['dewpoint_surface']),
    }),
    wind_gust: createManifestLayerFixture({
      [modelId]: has('gust_surface') ? available(['gust_surface']) : unavailable(['gust_surface']),
    }),
    air_pressure: createManifestLayerFixture({
      [modelId]: has('prmsl_msl') ? available(['prmsl_msl']) : unavailable(['prmsl_msl']),
    }),
    wind_speed: createManifestLayerFixture({
      [modelId]: has('wind10m_uv') ? available(['wind10m_uv']) : unavailable(['wind10m_uv']),
    }),
    precipitation_rate: createManifestLayerFixture({
      [modelId]: has('prate_surface') ? available(['prate_surface']) : unavailable(['prate_surface']),
    }),
    snow_depth: createManifestLayerFixture({
      [modelId]: has('snow_depth_surface') ? available(['snow_depth_surface']) : unavailable(['snow_depth_surface']),
    }),
    relative_humidity: createManifestLayerFixture({
      [modelId]: has('rh_surface') ? available(['rh_surface']) : unavailable(['rh_surface']),
    }),
    cloud_cover: createManifestLayerFixture({
      [modelId]: has('tcdc') ? available(['tcdc']) : unavailable(['tcdc']),
    }),
    low_cloud_cover: createManifestLayerFixture({
      [modelId]: has('low_clouds') ? available(['low_clouds']) : unavailable(['low_clouds']),
    }),
    middle_cloud_cover: createManifestLayerFixture({
      [modelId]: has('medium_clouds') ? available(['medium_clouds']) : unavailable(['medium_clouds']),
    }),
    high_cloud_cover: createManifestLayerFixture({
      [modelId]: has('high_clouds') ? available(['high_clouds']) : unavailable(['high_clouds']),
    }),
    visibility: createManifestLayerFixture({
      [modelId]: has('visibility_surface') ? available(['visibility_surface']) : unavailable(['visibility_surface']),
    }),
    freezing_level: createManifestLayerFixture({
      [modelId]: has('freezing_level') ? available(['freezing_level']) : unavailable(['freezing_level']),
    }),
    precipitable_water: createManifestLayerFixture({
      [modelId]: has('precipitable_water') ? available(['precipitable_water']) : unavailable(['precipitable_water']),
    }),
    accumulated_precipitation: createManifestLayerFixture({
      [modelId]: has('precip_total_surface') ? available(['precip_total_surface']) : unavailable(['precip_total_surface']),
    }),
    composite_reflectivity: createManifestLayerFixture({
      [modelId]: has('refc_entire_atmosphere') ? available(['refc_entire_atmosphere']) : unavailable(['refc_entire_atmosphere']),
    }),
    cape: createManifestLayerFixture({
      [modelId]: has('cape_index') ? available(['cape_index']) : unavailable(['cape_index']),
    }),
    cin: createManifestLayerFixture({
      [modelId]: has('cin_index') ? available(['cin_index']) : unavailable(['cin_index']),
    }),
  }
}

export function createLayerModelAvailabilityFixture(
  overrides: Partial<Manifest['layers'][string]['models'][string]> = {}
): Manifest['layers'][string]['models'][string] {
  return {
    state: 'available',
    support: 'native',
    requiredArtifacts: [],
    optionalArtifacts: [],
    ...overrides,
  }
}

export function createManifestLayerFixture(
  models: Record<string, Manifest['layers'][string]['models'][string]>
): Manifest['layers'][string] {
  return { models }
}

export function createManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): Manifest {
  const model = overrides.model ?? { id: FIXTURE_MODEL_ID, label: FIXTURE_MODEL_LABEL }
  const latest = createLatestRunFixture(overrides)
  return {
    schema: FORECAST_MANIFEST_SCHEMA,
    schemaVersion: FORECAST_MANIFEST_SCHEMA_VERSION,
    generatedAt: overrides.generatedAt ?? FIXTURE_GENERATED_AT,
    catalogVersion: 'forecast-catalog-v1',
    payloadContract: FORECAST_PAYLOAD_CONTRACT,
    models: {
      [model.id]: {
        label: model.label,
        latest,
      },
    },
    layers: overrides.layers ?? createManifestLayersFixture(latest.artifacts, model.id),
  }
}

export function createSingleTimeManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): Manifest {
  return createManifestFixture({
    forecastHours: [FIXTURE_HOUR_TOKEN],
    ...overrides,
  })
}

export function createActiveRunFixture(
  manifest: Manifest,
  modelId: ForecastModelId = FIXTURE_MODEL_ID
): ActiveForecastRun {
  const activeRun = activeForecastRunForModel(manifest, modelId)
  if (!activeRun) {
    throw new Error(`Missing active run fixture for model ${modelId}`)
  }
  return activeRun
}

export function createManifestPayloadFixture(
  overrides: ManifestFixtureOverrides = {}
): Record<string, unknown> {
  return createSingleTimeManifestFixture(overrides)
}
