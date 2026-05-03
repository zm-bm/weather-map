import {
  asScalarProductId,
  asVectorProductId,
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
  type CycleManifest,
  type ForecastModelSpec,
  type ForecastRunSpec,
  type ForecastTimeSpec,
  type FramePayloadRef,
  type ManifestProductSpec,
  type NonEmptyArray,
  type ScalarGridSpec,
  type ScalarEncodingSpec,
  type ScalarProductGroupSpec,
  type ScalarProductId,
  type VectorEncodingSpec,
} from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown, field: string): string {
  if (typeof v === 'string') return v
  throw new Error(`Invalid manifest field ${field}: expected string`)
}

function asFiniteNumber(v: unknown, field: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  throw new Error(`Invalid manifest field ${field}: expected finite number`)
}

function asLiteralString<T extends string>(v: unknown, field: string, expected: T): T {
  const value = asString(v, field)
  if (value !== expected) {
    throw new Error(`Invalid manifest field ${field}: expected ${expected}`)
  }
  return expected
}

function asOneOfStrings<T extends readonly string[]>(
  v: unknown,
  field: string,
  allowed: T
): T[number] {
  const value = asString(v, field)
  if (allowed.includes(value as T[number])) return value as T[number]
  throw new Error(`Invalid manifest field ${field}: expected one of ${allowed.join(', ')}`)
}

function asLiteralNumber<T extends number>(v: unknown, field: string, expected: T): T {
  const value = asFiniteNumber(v, field)
  if (value !== expected) {
    throw new Error(`Invalid manifest field ${field}: expected ${expected}`)
  }
  return expected
}

function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || !v.every((item) => typeof item === 'string')) {
    throw new Error(`Invalid manifest field ${field}: expected string[]`)
  }
  return v
}

function asNonEmptyArray<T>(values: T[], field: string): NonEmptyArray<T> {
  if (values.length < 1) {
    throw new Error(`Invalid manifest field ${field}: expected non-empty array`)
  }
  return values as NonEmptyArray<T>
}

function parseModel(raw: unknown): ForecastModelSpec {
  if (!isRecord(raw)) throw new Error('Invalid manifest field model: expected object')
  return {
    id: asString(raw.id, 'model.id'),
    label: asString(raw.label, 'model.label'),
  }
}

function parseRun(raw: unknown): ForecastRunSpec {
  if (!isRecord(raw)) throw new Error('Invalid manifest field run: expected object')
  return {
    cycle: asString(raw.cycle, 'run.cycle'),
    generatedAt: asString(raw.generatedAt, 'run.generatedAt'),
    revision: asString(raw.revision, 'run.revision'),
  }
}

function parseTimes(raw: unknown): ForecastTimeSpec[] {
  if (!Array.isArray(raw)) throw new Error('Invalid manifest field times: expected object[]')
  return raw.map((rawTime, idx) => {
    const field = `times[${idx}]`
    if (!isRecord(rawTime)) throw new Error(`Invalid manifest field ${field}: expected object`)
    return {
      id: asString(rawTime.id, `${field}.id`),
      leadHours: asFiniteNumber(rawTime.leadHours, `${field}.leadHours`),
      validAt: asString(rawTime.validAt, `${field}.validAt`),
    }
  })
}

function parseGrid(raw: unknown, field: string): ScalarGridSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return {
    id: asString(raw.id, `${field}.id`),
    crs: asString(raw.crs, `${field}.crs`),
    nx: asFiniteNumber(raw.nx, `${field}.nx`),
    ny: asFiniteNumber(raw.ny, `${field}.ny`),
    lon0: asFiniteNumber(raw.lon0, `${field}.lon0`),
    lat0: asFiniteNumber(raw.lat0, `${field}.lat0`),
    dx: asFiniteNumber(raw.dx, `${field}.dx`),
    dy: asFiniteNumber(raw.dy, `${field}.dy`),
    origin: asLiteralString(raw.origin, `${field}.origin`, 'cell_center'),
    layout: asLiteralString(raw.layout, `${field}.layout`, 'row_major'),
    xWrap: asOneOfStrings(raw.xWrap, `${field}.xWrap`, ['repeat', 'none'] as const),
    yMode: asLiteralString(raw.yMode, `${field}.yMode`, 'clamp'),
  }
}

function parseScalarEncoding(raw: unknown, field: string): ScalarEncodingSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  const id = asString(raw.id, `${field}.id`)
  const format = asString(raw.format, `${field}.format`)

  if (format === 'linear-i16-v1') {
    return {
      id,
      format,
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int16'),
      byteOrder: asOneOfStrings(raw.byteOrder, `${field}.byteOrder`, ['little', 'big'] as const),
      nodata: asFiniteNumber(raw.nodata, `${field}.nodata`),
      scale: asFiniteNumber(raw.scale, `${field}.scale`),
      offset: asFiniteNumber(raw.offset, `${field}.offset`),
      decodeFormula: asString(raw.decodeFormula, `${field}.decodeFormula`),
    }
  }

  if (format === 'linear-i8-v1') {
    const base = {
      id,
      format: 'linear-i8-v1' as const,
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byteOrder: asLiteralString(raw.byteOrder, `${field}.byteOrder`, 'none'),
      nodata: asFiniteNumber(raw.nodata, `${field}.nodata`),
      scale: asFiniteNumber(raw.scale, `${field}.scale`),
      offset: asFiniteNumber(raw.offset, `${field}.offset`),
      decodeFormula: asString(raw.decodeFormula, `${field}.decodeFormula`),
    }
    if ('components' in raw) {
      return {
        ...base,
        nodata: asLiteralNumber(raw.nodata, `${field}.nodata`, -128),
        scale: asLiteralNumber(raw.scale, `${field}.scale`, 5),
        offset: asLiteralNumber(raw.offset, `${field}.offset`, 0),
        components: parseCloudLayerComponents(raw.components, `${field}.components`),
      }
    }
    return base
  }

  if (format === 'temp-c-piecewise-i8-v1') {
    return {
      id,
      format,
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byteOrder: asLiteralString(raw.byteOrder, `${field}.byteOrder`, 'none'),
      nodata: asLiteralNumber(raw.nodata, `${field}.nodata`, -128),
    }
  }

  throw new Error(`Unsupported scalar encoding format at ${field}.format: ${format}`)
}

function parseVectorEncoding(raw: unknown, field: string): VectorEncodingSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  const id = asString(raw.id, `${field}.id`)
  const format = asLiteralString(raw.format, `${field}.format`, 'linear-i8-v1')

  return {
    id,
    format,
    dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
    byteOrder: asLiteralString(raw.byteOrder, `${field}.byteOrder`, 'none'),
    scale: asFiniteNumber(raw.scale, `${field}.scale`),
    offset: asFiniteNumber(raw.offset, `${field}.offset`),
    decodeFormula: asString(raw.decodeFormula, `${field}.decodeFormula`),
    components: parseVectorComponents(raw.components, `${field}.components`),
  }
}

function parseFrameRef(raw: unknown, field: string): FramePayloadRef {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return {
    path: asString(raw.path, `${field}.path`),
    byteLength: asFiniteNumber(raw.byteLength, `${field}.byteLength`),
    sha256: asString(raw.sha256, `${field}.sha256`),
  }
}

function parseFrames(raw: unknown, field: string): Record<string, FramePayloadRef> {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  const frames: Record<string, FramePayloadRef> = {}
  for (const [hourId, frameRaw] of Object.entries(raw)) {
    frames[hourId] = parseFrameRef(frameRaw, `${field}.${hourId}`)
  }
  return frames
}

function parseProducts(raw: unknown): Record<string, ManifestProductSpec> {
  if (!isRecord(raw)) throw new Error('Invalid manifest field products: expected object')
  const products: Record<string, ManifestProductSpec> = {}
  for (const [productId, rawProduct] of Object.entries(raw)) {
    const field = `products.${productId}`
    if (!isRecord(rawProduct)) throw new Error(`Invalid manifest field ${field}: expected object`)
    const id = asString(rawProduct.id, `${field}.id`)
    if (id !== productId) {
      throw new Error(`Manifest product key ${productId} does not match id ${id}`)
    }
    const common = {
      id,
      label: asString(rawProduct.label, `${field}.label`),
      units: asString(rawProduct.units, `${field}.units`),
      parameter: asString(rawProduct.parameter, `${field}.parameter`),
      level: asString(rawProduct.level, `${field}.level`),
      valueRange: parseValueRange(rawProduct.valueRange, `${field}.valueRange`),
      grid: parseGrid(rawProduct.grid, `${field}.grid`),
      frames: parseFrames(rawProduct.frames, `${field}.frames`),
    }
    const kind = asString(rawProduct.kind, `${field}.kind`)
    if (kind === 'scalar') {
      const encoding = parseScalarEncoding(rawProduct.encoding, `${field}.encoding`)
      products[productId] = { kind, encoding, ...common }
    } else if (kind === 'vector') {
      const encoding = parseVectorEncoding(rawProduct.encoding, `${field}.encoding`)
      products[productId] = { kind, encoding, ...common }
    } else {
      throw new Error(`Invalid manifest product kind at ${field}.kind: ${kind}`)
    }
  }
  return products
}

function parseValueRange(raw: unknown, field: string) {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return {
    min: asFiniteNumber(raw.min, `${field}.min`),
    max: asFiniteNumber(raw.max, `${field}.max`),
  }
}

type DecodedGroup = Omit<ScalarProductGroupSpec, 'defaultProduct' | 'products'> & {
  defaultProduct: string
  products: NonEmptyArray<string>
}

function parseGroups(raw: unknown, scalarProducts: string[]): DecodedGroup[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid manifest field groups: expected object[]')
  }
  if (raw.length < 1) {
    if (scalarProducts.length === 0) return []
    throw new Error('Invalid manifest field groups: expected non-empty object[] for scalar products')
  }

  const scalarProductSet = new Set(scalarProducts)
  const groupIds = new Set<string>()
  const seenProducts = new Set<string>()
  const groups = raw.map((rawGroup, groupIndex) => {
    const field = `groups[${groupIndex}]`
    if (!isRecord(rawGroup)) throw new Error(`Invalid manifest field ${field}: expected object`)

    const id = asString(rawGroup.id, `${field}.id`)
    if (groupIds.has(id)) throw new Error(`Manifest groups has duplicate group id ${id}`)
    groupIds.add(id)

    const kind = asLiteralString(rawGroup.kind, `${field}.kind`, 'scalar')
    const label = asString(rawGroup.label, `${field}.label`)
    const defaultProduct = asString(rawGroup.defaultProductId, `${field}.defaultProductId`)
    const products = asNonEmptyArray(asStringArray(rawGroup.productIds, `${field}.productIds`), `${field}.productIds`)

    if (!products.includes(defaultProduct)) {
      throw new Error(`Manifest groups entry ${id} defaultProductId ${defaultProduct} is not in productIds`)
    }

    for (const productId of products) {
      if (!scalarProductSet.has(productId)) {
        throw new Error(`Manifest groups entry ${id} references unknown scalar product ${productId}`)
      }
      if (seenProducts.has(productId)) {
        throw new Error(`Manifest groups assigns scalar product ${productId} to multiple groups`)
      }
      seenProducts.add(productId)
    }

    return {
      id,
      kind,
      label,
      defaultProduct,
      products,
    }
  })

  const missingProducts = scalarProducts.filter((productId) => !seenProducts.has(productId))
  if (missingProducts.length > 0) {
    throw new Error(`Manifest groups missing scalar products: ${missingProducts.join(', ')}`)
  }

  return groups
}

export function parseCycleManifest(raw: unknown): CycleManifest {
  if (!isRecord(raw)) throw new Error('Cycle manifest payload is not an object')

  const schema = asLiteralString(raw.schema, 'schema', MANIFEST_SCHEMA)
  const schemaVersion = asLiteralNumber(raw.schemaVersion, 'schemaVersion', MANIFEST_SCHEMA_VERSION)
  const payloadContract = asLiteralString(raw.payloadContract, 'payloadContract', MANIFEST_PAYLOAD_CONTRACT)
  const model = parseModel(raw.model)
  const run = parseRun(raw.run)
  const times = parseTimes(raw.times)
  const products = parseProducts(raw.products)
  validateTimes(times)
  validateProductFrames(products, times)

  const scalarProducts = Object.values(products).filter((product) => product.kind === 'scalar').map((product) => product.id)
  const vectorProducts = Object.values(products).filter((product) => product.kind === 'vector').map((product) => product.id)
  if (scalarProducts.length + vectorProducts.length < 1) {
    throw new Error('Invalid manifest field products: expected at least one product')
  }
  const decodedGroups = parseGroups(raw.groups, scalarProducts)
  const groups = decodedGroups.map((group) => ({
    id: group.id,
    kind: group.kind,
    label: group.label,
    defaultProduct: asScalarProductId(group.defaultProduct),
    products: group.products.map(asScalarProductId) as NonEmptyArray<ScalarProductId>,
  }))

  return {
    schema,
    schemaVersion,
    payloadContract,
    model,
    run,
    times,
    groups,
    products,
    scalarProducts: scalarProducts.map(asScalarProductId),
    vectorProducts: vectorProducts.map(asVectorProductId),
  }
}

function validateTimes(times: ForecastTimeSpec[]): void {
  if (times.length < 1) throw new Error('Invalid manifest field times: expected at least one time')
  const seen = new Set<string>()
  for (const time of times) {
    if (seen.has(time.id)) throw new Error(`Manifest times has duplicate id ${time.id}`)
    seen.add(time.id)
  }
}

function validateProductFrames(products: Record<string, ManifestProductSpec>, times: ForecastTimeSpec[]): void {
  for (const product of Object.values(products)) {
    for (const time of times) {
      if (!product.frames[time.id]) {
        throw new Error(`Manifest product ${product.id} missing frame for hour ${time.id}`)
      }
    }
  }
}

function parseVectorComponents(raw: unknown, field: string): ['u', 'v'] {
  const parts = asStringArray(raw, field)
  if (parts.length !== 2 || parts[0] !== 'u' || parts[1] !== 'v') {
    throw new Error(`Invalid manifest field ${field}: expected ['u', 'v']`)
  }
  return ['u', 'v']
}

function parseCloudLayerComponents(raw: unknown, field: string): ['low', 'medium', 'high'] {
  const parts = asStringArray(raw, field)
  if (parts.length !== 3 || parts[0] !== 'low' || parts[1] !== 'medium' || parts[2] !== 'high') {
    throw new Error(`Invalid manifest field ${field}: expected ['low', 'medium', 'high']`)
  }
  return ['low', 'medium', 'high']
}
