import type {
  CycleManifest,
  ForecastTimeSpec,
  FramePayloadRef,
  ManifestArtifactSpec,
  NonEmptyArray,
  ArtifactId,
  ScalarEncodingSpec,
  ScalarGridSpec,
  ScalarArtifactSpec,
  VectorEncodingSpec,
  VectorArtifactId,
  VectorArtifactSpec,
} from '../../manifest'
import {
  asArtifactId,
  asVectorArtifactId,
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
} from '../../manifest'

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

export type ManifestFixtureOverrides =
  Partial<Pick<CycleManifest, 'model' | 'run' | 'times' | 'artifacts'>> & {
    cycle?: string
    generatedAt?: string
    revision?: string
    forecastHours?: string[]
    scalarArtifactIds?: string[]
    vectorArtifactIds?: string[]
  }

export type ScalarArtifactFixtureOverrides =
  Partial<Omit<ScalarArtifactSpec, 'frames'>> & {
    cycle?: string
    forecastHours?: string[]
    times?: ForecastTimeSpec[]
    frames?: Record<string, FramePayloadRef>
  }

export type VectorArtifactFixtureOverrides =
  Partial<Omit<VectorArtifactSpec, 'frames'>> & {
    cycle?: string
    forecastHours?: string[]
    times?: ForecastTimeSpec[]
    frames?: Record<string, FramePayloadRef>
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

function createFramePath(
  artifactId: string,
  dtype: ManifestArtifactSpec['encoding']['dtype'],
  cycle = FIXTURE_CYCLE,
  hourToken = FIXTURE_HOUR_TOKEN
): string {
  const extension = dtype === 'int16' ? 'field.i16.bin' : 'field.i8.bin'
  return `fields/${cycle}/${hourToken}/${artifactId}.${extension}`
}

export function createFrameRefFixture(overrides: Partial<FramePayloadRef> = {}): FramePayloadRef {
  return {
    path: `fields/${FIXTURE_CYCLE}/${FIXTURE_HOUR_TOKEN}/payload.bin`,
    byteLength: 8,
    sha256: 'x',
    ...overrides,
  }
}

function createArtifactFrames(
  artifact: Pick<ManifestArtifactSpec, 'id' | 'encoding'>,
  times: ForecastTimeSpec[],
  cycle: string,
  overrides: Record<string, FramePayloadRef> = {}
): Record<string, FramePayloadRef> {
  return Object.fromEntries(
    times.map((time) => [
      time.id,
      overrides[time.id] ?? createFrameRefFixture({
        path: createFramePath(artifact.id, artifact.encoding.dtype, cycle, time.id),
      }),
    ])
  )
}

export function createScalarArtifactFixture(
  overrides: ScalarArtifactFixtureOverrides = {}
): ScalarArtifactSpec {
  const cycle = overrides.cycle ?? FIXTURE_CYCLE
  const times = overrides.times ?? createForecastTimesFixture(overrides.forecastHours, cycle)
  const id = overrides.id ?? FIXTURE_SCALAR_ID

  const artifact: Omit<ScalarArtifactSpec, 'frames'> = {
    id,
    kind: 'scalar',
    units: overrides.units ?? 'C',
    parameter: overrides.parameter ?? 'tmp',
    level: overrides.level ?? 'surface',
    components: overrides.components ?? ['value'],
    grid: overrides.grid ?? createGridFixture(),
    encoding: overrides.encoding ?? createScalarEncodingFixture(),
  }

  return {
    ...artifact,
    frames: overrides.frames ?? createArtifactFrames(artifact, times, cycle),
  }
}

export function createVectorArtifactFixture(
  overrides: VectorArtifactFixtureOverrides = {}
): VectorArtifactSpec {
  const cycle = overrides.cycle ?? FIXTURE_CYCLE
  const times = overrides.times ?? createForecastTimesFixture(overrides.forecastHours, cycle)
  const id = overrides.id ?? FIXTURE_VECTOR_ID

  const artifact: Omit<VectorArtifactSpec, 'frames'> = {
    id,
    kind: 'vector',
    units: overrides.units ?? 'm/s',
    parameter: overrides.parameter ?? 'vector',
    level: overrides.level ?? '10m_above_ground',
    components: overrides.components ?? ['u', 'v'],
    grid: overrides.grid ?? createGridFixture(),
    encoding: overrides.encoding ?? createVectorEncodingFixture(),
  }

  return {
    ...artifact,
    frames: overrides.frames ?? createArtifactFrames(artifact, times, cycle),
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

function completeArtifactFrames(
  artifact: ManifestArtifactSpec,
  times: ForecastTimeSpec[],
  cycle: string
): ManifestArtifactSpec {
  const frames = createArtifactFrames(artifact, times, cycle, artifact.frames)
  return {
    ...artifact,
    frames,
  }
}

function createManifestArtifacts(args: {
  scalarArtifactIds: ArtifactId[]
  vectorArtifactIds: VectorArtifactId[]
  overrides?: Record<string, ManifestArtifactSpec>
  times: ForecastTimeSpec[]
  cycle: string
}): Record<string, ManifestArtifactSpec> {
  const manifestArtifacts: Record<string, ManifestArtifactSpec> = {}

  for (const artifactId of args.scalarArtifactIds) {
    const override = args.overrides?.[artifactId]
    const artifact = override ? retargetArtifactOverride(override, artifactId) : createScalarArtifactFixture({
      id: artifactId,
      times: args.times,
      cycle: args.cycle,
    })
    manifestArtifacts[artifactId] = completeArtifactFrames(artifact, args.times, args.cycle)
  }

  for (const artifactId of args.vectorArtifactIds) {
    const override = args.overrides?.[artifactId]
    const artifact = override ? retargetArtifactOverride(override, artifactId) : createVectorArtifactFixture({
      id: artifactId,
      times: args.times,
      cycle: args.cycle,
    })
    manifestArtifacts[artifactId] = completeArtifactFrames(artifact, args.times, args.cycle)
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

export function createManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): CycleManifest {
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
  const scalarArtifactIds = toArtifactIds<ArtifactId>(
    defaultScalarArtifactIdValues,
    asArtifactId,
  )
  const vectorArtifactIds = toArtifactIds<VectorArtifactId>(
    defaultVectorArtifactIdValues,
    asVectorArtifactId,
  )
  const manifestArtifacts = createManifestArtifacts({
    scalarArtifactIds,
    vectorArtifactIds,
    overrides: overrides.artifacts,
    times,
    cycle,
  })
  const artifactsByKind = deriveArtifactsByKind(manifestArtifacts)

  return {
    schema: MANIFEST_SCHEMA,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    payloadContract: MANIFEST_PAYLOAD_CONTRACT,
    model: overrides.model ?? { id: 'gfs', label: 'GFS' },
    run: {
      cycle,
      generatedAt,
      revision,
    },
    times,
    artifacts: manifestArtifacts,
    artifactsByKind,
  }
}

export function createFrameManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): CycleManifest {
  return createManifestFixture({
    forecastHours: [FIXTURE_HOUR_TOKEN],
    ...overrides,
  })
}

function toCycleManifestPayload(
  manifest: CycleManifest
): Record<string, unknown> {
  return {
    schema: manifest.schema,
    schemaVersion: manifest.schemaVersion,
    payloadContract: manifest.payloadContract,
    model: manifest.model,
    run: manifest.run,
    times: manifest.times,
    artifacts: manifest.artifacts,
  }
}

export function createCycleManifestPayloadFixture(
  overrides: ManifestFixtureOverrides = {}
): Record<string, unknown> {
  return toCycleManifestPayload(createFrameManifestFixture(overrides))
}

function deriveArtifactsByKind(
  artifacts: Record<string, ManifestArtifactSpec>
): Record<string, NonEmptyArray<ArtifactId>> {
  const byKind: Record<string, ArtifactId[]> = {}
  for (const artifact of Object.values(artifacts)) {
    byKind[artifact.kind] ??= []
    byKind[artifact.kind].push(asArtifactId(artifact.id))
  }
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, ids]) => [kind, ids as NonEmptyArray<ArtifactId>])
  )
}
