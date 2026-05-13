import type {
  CycleManifest,
  ForecastTimeSpec,
  FramePayloadRef,
  ManifestProductSpec,
  NonEmptyArray,
  ProductId,
  ScalarEncodingSpec,
  ScalarGridSpec,
  ScalarProductSpec,
  VectorEncodingSpec,
  VectorProductId,
  VectorProductSpec,
} from '../../manifest/types'
import {
  asProductId,
  asVectorProductId,
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
} from '../../manifest/types'

export const FIXTURE_CYCLE = '2026041312'
export const FIXTURE_GENERATED_AT = '2026-04-13T12:00:00Z'
export const FIXTURE_REVISION = 'rev'
export const FIXTURE_HOUR_TOKEN = '000'
export const FIXTURE_GRID_ID = 'g0'
export const FIXTURE_SCALAR_ENCODING_ID = 'e0'
export const FIXTURE_VECTOR_ENCODING_ID = 'wind10m_uv_vector_i8_v1'
export const FIXTURE_SCALAR_ID = asProductId('tmp_surface')
export const FIXTURE_VECTOR_ID = asVectorProductId('wind10m_uv')
export const DEFAULT_FORECAST_HOURS = [FIXTURE_HOUR_TOKEN, '003']

export type ManifestFixtureOverrides =
  Partial<Pick<CycleManifest, 'model' | 'run' | 'times' | 'products'>> & {
    cycle?: string
    generatedAt?: string
    revision?: string
    forecastHours?: string[]
    scalarProducts?: string[]
    vectorProducts?: string[]
  }

export type ScalarProductFixtureOverrides =
  Partial<Omit<ScalarProductSpec, 'frames'>> & {
    cycle?: string
    forecastHours?: string[]
    times?: ForecastTimeSpec[]
    frames?: Record<string, FramePayloadRef>
  }

export type VectorProductFixtureOverrides =
  Partial<Omit<VectorProductSpec, 'frames'>> & {
    cycle?: string
    forecastHours?: string[]
    times?: ForecastTimeSpec[]
    frames?: Record<string, FramePayloadRef>
  }

function toProductIds<T>(
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
  productId: string,
  dtype: ManifestProductSpec['encoding']['dtype'],
  cycle = FIXTURE_CYCLE,
  hourToken = FIXTURE_HOUR_TOKEN
): string {
  const extension = dtype === 'int16' ? 'field.i16.bin' : 'field.i8.bin'
  return `fields/${cycle}/${hourToken}/${productId}.${extension}`
}

export function createFrameRefFixture(overrides: Partial<FramePayloadRef> = {}): FramePayloadRef {
  return {
    path: `fields/${FIXTURE_CYCLE}/${FIXTURE_HOUR_TOKEN}/payload.bin`,
    byteLength: 8,
    sha256: 'x',
    ...overrides,
  }
}

function createProductFrames(
  product: Pick<ManifestProductSpec, 'id' | 'encoding'>,
  times: ForecastTimeSpec[],
  cycle: string,
  overrides: Record<string, FramePayloadRef> = {}
): Record<string, FramePayloadRef> {
  return Object.fromEntries(
    times.map((time) => [
      time.id,
      overrides[time.id] ?? createFrameRefFixture({
        path: createFramePath(product.id, product.encoding.dtype, cycle, time.id),
      }),
    ])
  )
}

export function createScalarProductFixture(
  overrides: ScalarProductFixtureOverrides = {}
): ScalarProductSpec {
  const cycle = overrides.cycle ?? FIXTURE_CYCLE
  const times = overrides.times ?? createForecastTimesFixture(overrides.forecastHours, cycle)
  const id = overrides.id ?? FIXTURE_SCALAR_ID

  const product: Omit<ScalarProductSpec, 'frames'> = {
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
    ...product,
    frames: overrides.frames ?? createProductFrames(product, times, cycle),
  }
}

export function createVectorProductFixture(
  overrides: VectorProductFixtureOverrides = {}
): VectorProductSpec {
  const cycle = overrides.cycle ?? FIXTURE_CYCLE
  const times = overrides.times ?? createForecastTimesFixture(overrides.forecastHours, cycle)
  const id = overrides.id ?? FIXTURE_VECTOR_ID

  const product: Omit<VectorProductSpec, 'frames'> = {
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
    ...product,
    frames: overrides.frames ?? createProductFrames(product, times, cycle),
  }
}

function productIdsByKind(
  products: Record<string, ManifestProductSpec> | undefined,
  kind: ManifestProductSpec['kind']
): string[] {
  return Object.values(products ?? {})
    .filter((product) => product.kind === kind)
    .map((product) => product.id)
}

function completeProductFrames(
  product: ManifestProductSpec,
  times: ForecastTimeSpec[],
  cycle: string
): ManifestProductSpec {
  const frames = createProductFrames(product, times, cycle, product.frames)
  return {
    ...product,
    frames,
  }
}

function createProducts(args: {
  scalarProducts: ProductId[]
  vectorProducts: VectorProductId[]
  overrides?: Record<string, ManifestProductSpec>
  times: ForecastTimeSpec[]
  cycle: string
}): Record<string, ManifestProductSpec> {
  const products: Record<string, ManifestProductSpec> = {}

  for (const productId of args.scalarProducts) {
    const override = args.overrides?.[productId]
    const product = override ? retargetProductOverride(override, productId) : createScalarProductFixture({
      id: productId,
      times: args.times,
      cycle: args.cycle,
    })
    products[productId] = completeProductFrames(product, args.times, args.cycle)
  }

  for (const productId of args.vectorProducts) {
    const override = args.overrides?.[productId]
    const product = override ? retargetProductOverride(override, productId) : createVectorProductFixture({
      id: productId,
      times: args.times,
      cycle: args.cycle,
    })
    products[productId] = completeProductFrames(product, args.times, args.cycle)
  }

  return products
}

function retargetProductOverride(
  product: ManifestProductSpec,
  productId: ProductId
): ManifestProductSpec {
  return {
    ...product,
    id: productId,
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
  const scalarProductIds = overrides.scalarProducts ?? productIdsByKind(overrides.products, 'scalar')
  const vectorProductIds = overrides.vectorProducts ?? productIdsByKind(overrides.products, 'vector')
  const defaultScalarProductIds = (
    overrides.scalarProducts === undefined
    && overrides.products === undefined
    && scalarProductIds.length === 0
  )
    ? [FIXTURE_SCALAR_ID]
    : scalarProductIds
  const defaultVectorProductIds = (
    overrides.vectorProducts === undefined
    && overrides.products === undefined
    && vectorProductIds.length === 0
  )
    ? [FIXTURE_VECTOR_ID]
    : vectorProductIds
  if (defaultScalarProductIds.length + defaultVectorProductIds.length < 1) {
    throw new Error('createManifestFixture requires at least one product id')
  }
  const scalarProducts = toProductIds<ProductId>(
    defaultScalarProductIds,
    asProductId,
  )
  const vectorProducts = toProductIds<VectorProductId>(
    defaultVectorProductIds,
    asVectorProductId,
  )
  const products = createProducts({
    scalarProducts,
    vectorProducts,
    overrides: overrides.products,
    times,
    cycle,
  })
  const productsByKind = deriveProductsByKind(products)

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
    products,
    productsByKind,
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
    products: manifest.products,
  }
}

export function createCycleManifestPayloadFixture(
  overrides: ManifestFixtureOverrides = {}
): Record<string, unknown> {
  return toCycleManifestPayload(createFrameManifestFixture(overrides))
}

function deriveProductsByKind(
  products: Record<string, ManifestProductSpec>
): Record<string, NonEmptyArray<ProductId>> {
  const byKind: Record<string, ProductId[]> = {}
  for (const product of Object.values(products)) {
    byKind[product.kind] ??= []
    byKind[product.kind].push(asProductId(product.id))
  }
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, ids]) => [kind, ids as NonEmptyArray<ProductId>])
  )
}
