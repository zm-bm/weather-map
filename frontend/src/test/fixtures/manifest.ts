import type {
  CycleManifest,
  FramePayloadRef,
  LatestManifest,
  NonEmptyArray,
  ScalarEncodingSpec,
  ScalarGridSpec,
  ScalarVariableId,
  ScalarVariableSpec,
  VectorEncodingSpec,
  VectorVariableId,
  VectorVariableSpec,
} from '../../manifest/types'
import {
  asScalarVariableId,
  asVectorVariableId,
} from '../../manifest/types'

export const FIXTURE_CYCLE = '2026041312'
export const FIXTURE_GENERATED_AT = '2026-04-13T12:00:00Z'
export const FIXTURE_REVISION = 'rev'
export const FIXTURE_HOUR_TOKEN = '000'
export const FIXTURE_GRID_ID = 'g0'
export const FIXTURE_SCALAR_ENCODING_ID = 'e0'
export const FIXTURE_VECTOR_ENCODING_ID = 'wind10m_uv_vector_i8_v1'
export const FIXTURE_SCALAR_ID = asScalarVariableId('tmp_surface')
export const FIXTURE_VECTOR_ID = asVectorVariableId('wind10m_uv')

export type ManifestFixtureOverrides =
  Partial<Omit<CycleManifest, 'scalarVariables' | 'vectorVariables'>> & {
    scalarVariables?: string[]
    vectorVariables?: string[]
  }

type LatestManifestFixtureOverrides = Partial<{
  cycle: string
  generatedAt: string
  revision: string
}>

function toNonEmptyIds<T>(
  values: string[],
  brand: (value: string) => T,
  fieldName: 'scalar' | 'vector'
): NonEmptyArray<T> {
  if (values.length < 1) {
    throw new Error(`createManifestFixture requires at least one ${fieldName} variable id`)
  }
  return values.map(brand) as NonEmptyArray<T>
}

function createGridFixture(): ScalarGridSpec {
  return {
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
  }
}

function createScalarEncodingFixture(): ScalarEncodingSpec {
  return {
    format: 'scalar-i16-linear-v1',
    dtype: 'int16',
    byte_order: 'little',
    nodata: -32768,
    scale: 0.01,
    offset: 0,
    decode_formula: 'value = stored * scale + offset',
  }
}

function createVectorEncodingFixture(): VectorEncodingSpec {
  return {
    format: 'uv-i8-q0p5-v1',
    dtype: 'int8',
    byte_order: 'none',
    scale: 0.5,
    offset: 0,
    decode_formula: 'value = stored * scale + offset',
    components: ['u', 'v'],
    component_count: 2,
    component_order: 'u_then_v',
  }
}

function createFramePath(
  variableId: string,
  domain: 'scalar' | 'vector',
  cycle = FIXTURE_CYCLE,
  hourToken = FIXTURE_HOUR_TOKEN
): string {
  const extension = domain === 'scalar' ? 'scalar.i16.bin' : 'vector.i8.bin'
  return `fields/${cycle}/${hourToken}/${variableId}.${extension}`
}

export function createManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): CycleManifest {
  const {
    scalarVariables: overrideScalarVariables,
    vectorVariables: overrideVectorVariables,
    ...restOverrides
  } = overrides

  const scalarVariables = toNonEmptyIds<ScalarVariableId>(
    overrideScalarVariables ?? [FIXTURE_SCALAR_ID],
    asScalarVariableId,
    'scalar'
  )
  const vectorVariables = toNonEmptyIds<VectorVariableId>(
    overrideVectorVariables ?? [FIXTURE_VECTOR_ID],
    asVectorVariableId,
    'vector'
  )

  return {
    version: 4,
    contract: 'forecast-binary-v2',
    cycle: FIXTURE_CYCLE,
    generatedAt: FIXTURE_GENERATED_AT,
    revision: FIXTURE_REVISION,
    forecastHours: ['000', '003'],
    scalarVariables,
    vectorVariables,
    grids: {},
    encodings: {},
    variableMeta: {},
    frames: {},
    ...restOverrides,
  }
}

export function createScalarVariableMetaFixture(
  overrides: Partial<ScalarVariableSpec> = {}
): ScalarVariableSpec {
  return {
    kind: 'scalar',
    units: 'C',
    parameter: 'tmp',
    level: 'surface',
    valid_min: -45,
    valid_max: 50,
    grid_id: FIXTURE_GRID_ID,
    encoding_id: FIXTURE_SCALAR_ENCODING_ID,
    ...overrides,
  }
}

export function createVectorVariableMetaFixture(
  overrides: Partial<VectorVariableSpec> = {}
): VectorVariableSpec {
  return {
    kind: 'vector',
    units: 'm/s',
    parameter: 'vector',
    level: '10m_above_ground',
    valid_min: -64,
    valid_max: 63.5,
    grid_id: FIXTURE_GRID_ID,
    encoding_id: FIXTURE_VECTOR_ENCODING_ID,
    ...overrides,
  }
}

export function createFrameManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): CycleManifest {
  return createManifestFixture({
    forecastHours: [FIXTURE_HOUR_TOKEN],
    grids: {
      g0: createGridFixture(),
    },
    encodings: {
      e0: createScalarEncodingFixture(),
      [FIXTURE_VECTOR_ENCODING_ID]: createVectorEncodingFixture(),
    },
    variableMeta: {
      [FIXTURE_SCALAR_ID]: createScalarVariableMetaFixture(),
      [FIXTURE_VECTOR_ID]: createVectorVariableMetaFixture(),
    },
    frames: {
      [FIXTURE_HOUR_TOKEN]: {
        [FIXTURE_SCALAR_ID]: createFrameRefFixture({
          path: createFramePath(FIXTURE_SCALAR_ID, 'scalar'),
        }),
        [FIXTURE_VECTOR_ID]: createFrameRefFixture({
          path: createFramePath(FIXTURE_VECTOR_ID, 'vector'),
        }),
      },
    },
    ...overrides,
  })
}

export function createFrameRefFixture(
  overrides: Partial<FramePayloadRef> = {}
): FramePayloadRef {
  return {
    path: `fields/${FIXTURE_CYCLE}/${FIXTURE_HOUR_TOKEN}/payload.bin`,
    byte_length: 8,
    sha256: 'x',
    ...overrides,
  }
}

function toCycleManifestPayload(
  manifest: CycleManifest
): Record<string, unknown> {
  return {
    version: manifest.version,
    contract: manifest.contract,
    cycle: manifest.cycle,
    generated_at: manifest.generatedAt,
    revision: manifest.revision,
    forecast_hours: [...manifest.forecastHours],
    scalar_variables: [...manifest.scalarVariables],
    vector_variables: [...manifest.vectorVariables],
    grids: manifest.grids,
    encodings: manifest.encodings,
    variable_meta: manifest.variableMeta,
    frames: manifest.frames,
  }
}

export function createCycleManifestPayloadFixture(
  overrides: ManifestFixtureOverrides = {}
): Record<string, unknown> {
  const {
    scalarVariables,
    vectorVariables,
    ...manifestOverrides
  } = overrides

  const payload = toCycleManifestPayload(createFrameManifestFixture({
    variableMeta: {
      [FIXTURE_SCALAR_ID]: createScalarVariableMetaFixture(),
      [FIXTURE_VECTOR_ID]: createVectorVariableMetaFixture({
        parameter: 'wind_uv',
      }),
    },
    frames: {
      [FIXTURE_HOUR_TOKEN]: {
        [FIXTURE_SCALAR_ID]: createFrameRefFixture({
          path: createFramePath(FIXTURE_SCALAR_ID, 'scalar'),
          sha256: 'a',
        }),
        [FIXTURE_VECTOR_ID]: createFrameRefFixture({
          path: createFramePath(FIXTURE_VECTOR_ID, 'vector'),
          sha256: 'b',
        }),
      },
    },
    ...manifestOverrides,
  }))

  return {
    ...payload,
    ...(scalarVariables ? { scalar_variables: scalarVariables } : {}),
    ...(vectorVariables ? { vector_variables: vectorVariables } : {}),
  }
}

export function createLatestManifestPayloadFixture(
  overrides: LatestManifestFixtureOverrides = {}
): LatestManifest {
  const manifest = createManifestFixture({
    ...(overrides.cycle ? { cycle: overrides.cycle } : {}),
    ...(overrides.generatedAt ? { generatedAt: overrides.generatedAt } : {}),
    ...(overrides.revision ? { revision: overrides.revision } : {}),
  })

  return {
    cycle: manifest.cycle,
    generated_at: manifest.generatedAt,
    revision: manifest.revision,
  }
}
