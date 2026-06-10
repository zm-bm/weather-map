import type {
  ActiveForecastRun,
  ForecastDatasetId,
  ForecastDatasetOption,
  ForecastFrameSpec,
  ForecastManifestData,
  ForecastManifestState,
  LatestForecastRun,
  Manifest,
  ManifestArtifactSpec,
  ScalarArtifactSpec,
  ScalarEncodingSpec,
  GridSpec,
  VectorArtifactSpec,
  VectorEncodingSpec,
} from '@/forecast/manifest'
import {
  MANIFEST_INDEX_SCHEMA,
  MANIFEST_INDEX_SCHEMA_VERSION,
  DATA_PAYLOAD_CONTRACT,
  activeForecastRunForDataset,
  datasetOptionsFromManifest,
} from '@/forecast/manifest'

const FIXTURE_DATASET_ID = 'gfs'
const FIXTURE_DATASET_LABEL = 'GFS'
const FIXTURE_CYCLE = '2026041312'
const FIXTURE_RUN_ID = '20260413T120000Z-abcdef12'
const FIXTURE_GENERATED_AT = '2026-04-13T12:00:00Z'
const FIXTURE_REVISION = 'rev'
const FIXTURE_FRAME_ID = '000'
const FIXTURE_GRID_ID = 'g0'
const FIXTURE_SCALAR_ENCODING_ID = 'e0'
const FIXTURE_VECTOR_ENCODING_ID = 'wind10m_uv_vector_i8_1ms_v1'
const FIXTURE_SCALAR_ID = 'tmp_surface'
const FIXTURE_VECTOR_ID = 'wind10m_uv'
const DEFAULT_FRAME_IDS = [FIXTURE_FRAME_ID, '003']

const FIELD_DTYPE_SUFFIX = {
  int8: 'i8',
} satisfies Record<ManifestArtifactSpec['encoding']['dtype'], string>

export type ManifestFixtureOverrides = {
  dataset?: { id: ForecastDatasetId; label: string }
  run?: LatestForecastRun['run']
  frames?: ForecastFrameSpec[]
  artifacts?: Record<string, ManifestArtifactSpec>
  layers?: Manifest['layers']
  cycle?: string
  generated_at?: string
  revision?: string
  frameIds?: string[]
  scalarArtifactIds?: string[]
  vectorArtifactIds?: string[]
}

type ScalarArtifactFixtureOverrides = Partial<ScalarArtifactSpec> & {
  cycle?: string
  frameIds?: string[]
  frames?: ForecastFrameSpec[]
}

type VectorArtifactFixtureOverrides = Partial<VectorArtifactSpec> & {
  cycle?: string
  frameIds?: string[]
  frames?: ForecastFrameSpec[]
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
  frameIds: string[] = DEFAULT_FRAME_IDS,
  cycle = FIXTURE_CYCLE
): ForecastFrameSpec[] {
  return frameIds.map((hourId) => ({
    id: hourId,
    lead_hours: Number.parseInt(hourId, 10),
    valid_at: toForecastValidAt(cycle, hourId),
  }))
}

export function createGridFixture(overrides: Partial<GridSpec> = {}): GridSpec {
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
    x_wrap: 'repeat',
    y_mode: 'clamp',
    ...overrides,
  }
}

export function createScalarEncodingFixture(overrides: Partial<ScalarEncodingSpec> = {}): ScalarEncodingSpec {
  return {
    id: FIXTURE_SCALAR_ENCODING_ID,
    format: 'linear-i8-v1',
    dtype: 'int8',
    byte_order: 'none',
    nodata: -128,
    scale: 1,
    offset: 0,
    decode_formula: 'value = stored * scale + offset',
    ...overrides,
  } as ScalarEncodingSpec
}

export function createVectorEncodingFixture(overrides: Partial<VectorEncodingSpec> = {}): VectorEncodingSpec {
  return {
    id: FIXTURE_VECTOR_ENCODING_ID,
    format: 'linear-i8-v1',
    dtype: 'int8',
    byte_order: 'none',
    scale: 1,
    offset: 0,
    decode_formula: 'value = stored * scale + offset',
    ...overrides,
  }
}

function payloadByteLength(args: {
  grid: GridSpec
  components: readonly string[]
  dtype: ManifestArtifactSpec['encoding']['dtype']
}): number {
  void args.dtype
  return args.grid.nx * args.grid.ny * args.components.length
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
    byte_length: overrides.byte_length ?? payloadByteLength({
      grid,
      components,
      dtype: encoding.dtype,
    }),
    payload_file: overrides.payload_file ?? `${id}.${FIELD_DTYPE_SUFFIX[encoding.dtype]}.bin`,
    temporal_kind: overrides.temporal_kind,
    source_interval_hours: overrides.source_interval_hours,
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
    byte_length: overrides.byte_length ?? payloadByteLength({
      grid,
      components,
      dtype: encoding.dtype,
    }),
    payload_file: overrides.payload_file ?? `${id}.${FIELD_DTYPE_SUFFIX[encoding.dtype]}.bin`,
    temporal_kind: overrides.temporal_kind,
    source_interval_hours: overrides.source_interval_hours,
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
  scalarArtifactIds: string[]
  vectorArtifactIds: string[]
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
  artifactId: string
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
  const run_id = overrides.run?.run_id ?? FIXTURE_RUN_ID
  const generated_at = overrides.generated_at ?? overrides.run?.generated_at ?? FIXTURE_GENERATED_AT
  const revision = overrides.revision ?? overrides.run?.revision ?? FIXTURE_REVISION
  const frames = overrides.frames ?? createForecastTimesFixture(
    overrides.frameIds ?? DEFAULT_FRAME_IDS,
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
      ...overrides.run,
      cycle,
      run_id,
      payload_root: overrides.run?.payload_root ?? `runs/${overrides.dataset?.id ?? FIXTURE_DATASET_ID}/${cycle}/${run_id}/payloads`,
      generated_at,
      revision,
    },
    frames,
    artifacts: createManifestArtifacts({
      scalarArtifactIds: defaultScalarArtifactIdValues,
      vectorArtifactIds: defaultVectorArtifactIdValues,
      overrides: overrides.artifacts,
    }),
  }
}

function createManifestLayersFixture(
  artifacts: Record<string, ManifestArtifactSpec> = {},
  datasetId: ForecastDatasetId = FIXTURE_DATASET_ID
): Manifest['layers'] {
  const has = (artifactId: string) => artifactId in artifacts
  const available = (required_artifacts: string[], optional_artifacts: string[] = []) => createLayerDatasetAvailabilityFixture({
    required_artifacts,
    optional_artifacts,
  })
  const unavailable = (required_artifacts: string[], optional_artifacts: string[] = []) => createLayerDatasetAvailabilityFixture({
    state: 'temporarily_unavailable',
    required_artifacts,
    optional_artifacts,
  })

  return {
    temperature: createManifestLayerFixture({
      [datasetId]: has('tmp_surface') ? available(['tmp_surface']) : unavailable(['tmp_surface']),
    }),
    apparent_temperature: createManifestLayerFixture({
      [datasetId]: has('aptmp_surface') ? available(['aptmp_surface']) : unavailable(['aptmp_surface']),
    }),
    dew_point: createManifestLayerFixture({
      [datasetId]: has('dewpoint_surface') ? available(['dewpoint_surface']) : unavailable(['dewpoint_surface']),
    }),
    wind_gust: createManifestLayerFixture({
      [datasetId]: has('gust_surface') ? available(['gust_surface']) : unavailable(['gust_surface']),
    }),
    air_pressure: createManifestLayerFixture({
      [datasetId]: has('prmsl_msl') ? available(['prmsl_msl']) : unavailable(['prmsl_msl']),
    }),
    wind_speed: createManifestLayerFixture({
      [datasetId]: has('wind10m_uv') ? available(['wind10m_uv']) : unavailable(['wind10m_uv']),
    }),
    precipitation_rate: createManifestLayerFixture({
      [datasetId]: has('prate_surface')
        ? available(['prate_surface'], ['precip_type_surface'])
        : unavailable(['prate_surface'], ['precip_type_surface']),
    }),
    snow_depth: createManifestLayerFixture({
      [datasetId]: has('snow_depth_surface') ? available(['snow_depth_surface']) : unavailable(['snow_depth_surface']),
    }),
    relative_humidity: createManifestLayerFixture({
      [datasetId]: has('rh_surface') ? available(['rh_surface']) : unavailable(['rh_surface']),
    }),
    cloud_cover: createManifestLayerFixture({
      [datasetId]: has('tcdc') ? available(['tcdc']) : unavailable(['tcdc']),
    }),
    cloud_layers: createManifestLayerFixture({
      [datasetId]: has('cloud_layers') ? available(['cloud_layers']) : unavailable(['cloud_layers']),
    }),
    visibility: createManifestLayerFixture({
      [datasetId]: has('visibility_surface') ? available(['visibility_surface']) : unavailable(['visibility_surface']),
    }),
    freezing_level: createManifestLayerFixture({
      [datasetId]: has('freezing_level') ? available(['freezing_level']) : unavailable(['freezing_level']),
    }),
    precipitable_water: createManifestLayerFixture({
      [datasetId]: has('precipitable_water') ? available(['precipitable_water']) : unavailable(['precipitable_water']),
    }),
    accumulated_precipitation: createManifestLayerFixture({
      [datasetId]: has('precip_total_surface') ? available(['precip_total_surface']) : unavailable(['precip_total_surface']),
    }),
    composite_reflectivity: createManifestLayerFixture({
      [datasetId]: has('refc_entire_atmosphere') ? available(['refc_entire_atmosphere']) : unavailable(['refc_entire_atmosphere']),
    }),
    cape: createManifestLayerFixture({
      [datasetId]: has('cape_index') ? available(['cape_index']) : unavailable(['cape_index']),
    }),
    cin: createManifestLayerFixture({
      [datasetId]: has('cin_index') ? available(['cin_index']) : unavailable(['cin_index']),
    }),
  }
}

export function createLayerDatasetAvailabilityFixture(
  overrides: Partial<Manifest['layers'][string]['datasets'][string]> = {}
): Manifest['layers'][string]['datasets'][string] {
  return {
    state: 'available',
    support: 'native',
    required_artifacts: [],
    optional_artifacts: [],
    ...overrides,
  }
}

export function createManifestLayerFixture(
  datasets: Record<string, Manifest['layers'][string]['datasets'][string]>
): Manifest['layers'][string] {
  return { datasets }
}

export function createManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): Manifest {
  const dataset = overrides.dataset ?? { id: FIXTURE_DATASET_ID, label: FIXTURE_DATASET_LABEL }
  const latest = createLatestRunFixture(overrides)
  return {
    schema: MANIFEST_INDEX_SCHEMA,
    schema_version: MANIFEST_INDEX_SCHEMA_VERSION,
    generated_at: overrides.generated_at ?? FIXTURE_GENERATED_AT,
    catalog_version: 'forecast-catalog-v1',
    payload_contract: DATA_PAYLOAD_CONTRACT,
    datasets: {
      [dataset.id]: {
        label: dataset.label,
        latest,
      },
    },
    layers: overrides.layers ?? createManifestLayersFixture(latest.artifacts, dataset.id),
  }
}

export function createSingleTimeManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): Manifest {
  return createManifestFixture({
    frameIds: [FIXTURE_FRAME_ID],
    ...overrides,
  })
}

export function createActiveRunFixture(
  manifest: Manifest,
  datasetId: ForecastDatasetId = FIXTURE_DATASET_ID
): ActiveForecastRun {
  const activeRun = activeForecastRunForDataset(manifest, datasetId)
  if (!activeRun) {
    throw new Error(`Missing active run fixture for dataset ${datasetId}`)
  }
  return activeRun
}

export function createManifestPayloadFixture(
  overrides: ManifestFixtureOverrides = {}
): Record<string, unknown> {
  return createSingleTimeManifestFixture(overrides)
}

export function createForecastManifestDataFixture(args: {
  manifest?: Manifest
  datasetOptions?: readonly ForecastDatasetOption[]
} = {}): ForecastManifestData {
  const manifest = args.manifest ?? createManifestFixture()

  return {
    manifest,
    datasetOptions: args.datasetOptions ?? datasetOptionsFromManifest(manifest),
  }
}

export function createForecastManifestStateFixture(args: {
  phase?: ForecastManifestState['phase']
  data?: ForecastManifestData | null
  error?: Error | null
  retry?: () => void
} = {}): ForecastManifestState {
  const phase = args.phase ?? 'ready'
  const data = args.data === undefined
    ? phase === 'ready' ? createForecastManifestDataFixture() : null
    : args.data

  return {
    phase,
    data,
    error: args.error ?? null,
    retry: args.retry ?? (() => undefined),
  }
}
