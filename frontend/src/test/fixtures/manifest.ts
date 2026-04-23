import type {
  CycleManifest,
  FramePayloadRef,
  NonEmptyArray,
  ScalarVariableId,
  ScalarVariableSpec,
  VectorVariableId,
  VectorVariableSpec,
} from '../../manifest/types'
import {
  asScalarVariableId,
  asVectorVariableId,
} from '../../manifest/types'

export const FIXTURE_CYCLE = '2026041312'
export const FIXTURE_HOUR_TOKEN = '000'
export const FIXTURE_SCALAR_ID = asScalarVariableId('tmp_surface')
export const FIXTURE_VECTOR_ID = asVectorVariableId('wind10m_uv')

type ManifestFixtureOverrides =
  Partial<Omit<CycleManifest, 'scalarVariables' | 'vectorVariables'>> & {
    scalarVariables?: string[]
    vectorVariables?: string[]
  }

function toNonEmptyScalarIds(values: string[]): NonEmptyArray<ScalarVariableId> {
  if (values.length < 1) {
    throw new Error('createManifestFixture requires at least one scalar variable id')
  }
  return values.map(asScalarVariableId) as NonEmptyArray<ScalarVariableId>
}

function toNonEmptyVectorIds(values: string[]): NonEmptyArray<VectorVariableId> {
  if (values.length < 1) {
    throw new Error('createManifestFixture requires at least one vector variable id')
  }
  return values.map(asVectorVariableId) as NonEmptyArray<VectorVariableId>
}

export function createManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): CycleManifest {
  const {
    scalarVariables: overrideScalarVariables,
    vectorVariables: overrideVectorVariables,
    ...restOverrides
  } = overrides

  const scalarVariables = toNonEmptyScalarIds(
    overrideScalarVariables ?? [FIXTURE_SCALAR_ID]
  )
  const vectorVariables = toNonEmptyVectorIds(
    overrideVectorVariables ?? [FIXTURE_VECTOR_ID]
  )

  return {
    version: 4,
    contract: 'forecast-binary-v2',
    cycle: FIXTURE_CYCLE,
    generatedAt: '2026-04-13T12:00:00Z',
    revision: 'rev',
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
    grid_id: 'g0',
    encoding_id: 'e0',
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
    grid_id: 'g0',
    encoding_id: 'wind10m_uv_vector_i8_v1',
    ...overrides,
  }
}

export function createFrameManifestFixture(
  overrides: ManifestFixtureOverrides = {}
): CycleManifest {
  return createManifestFixture({
    forecastHours: [FIXTURE_HOUR_TOKEN],
    grids: {
      g0: {
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
      },
    },
    encodings: {
      e0: {
        format: 'scalar-i16-linear-v1',
        dtype: 'int16',
        byte_order: 'little',
        nodata: -32768,
        scale: 0.01,
        offset: 0,
        decode_formula: 'value = stored * scale + offset',
      },
      wind10m_uv_vector_i8_v1: {
        format: 'uv-i8-q0p5-v1',
        dtype: 'int8',
        byte_order: 'none',
        scale: 0.5,
        offset: 0,
        decode_formula: 'value = stored * scale + offset',
        components: ['u', 'v'],
        component_count: 2,
        component_order: 'u_then_v',
      },
    },
    variableMeta: {
      [FIXTURE_SCALAR_ID]: createScalarVariableMetaFixture(),
      [FIXTURE_VECTOR_ID]: createVectorVariableMetaFixture(),
    },
    frames: {
      [FIXTURE_HOUR_TOKEN]: {
        [FIXTURE_SCALAR_ID]: createFrameRefFixture({
          path: `fields/${FIXTURE_CYCLE}/${FIXTURE_HOUR_TOKEN}/${FIXTURE_SCALAR_ID}.scalar.i16.bin`,
        }),
        [FIXTURE_VECTOR_ID]: createFrameRefFixture({
          path: `fields/${FIXTURE_CYCLE}/${FIXTURE_HOUR_TOKEN}/${FIXTURE_VECTOR_ID}.vector.i8.bin`,
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
