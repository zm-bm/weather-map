import {
  asProductId,
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
  type ProductGroupSpec,
  type ProductId,
  type ProductStyleBinding,
  type ProductStyleSpec,
  type ScalarGridSpec,
  type ScalarEncodingSpec,
  type VectorEncodingSpec,
} from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown, field: string): string {
  if (typeof v === 'string') return v
  throw new Error(`Invalid manifest field ${field}: expected string`)
}

function asNonEmptyString(v: unknown, field: string): string {
  const value = asString(v, field).trim()
  if (value.length > 0) return value
  throw new Error(`Invalid manifest field ${field}: expected non-empty string`)
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
    return {
      id,
      format: 'linear-i8-v1' as const,
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byteOrder: asLiteralString(raw.byteOrder, `${field}.byteOrder`, 'none'),
      nodata: asFiniteNumber(raw.nodata, `${field}.nodata`),
      scale: asFiniteNumber(raw.scale, `${field}.scale`),
      offset: asFiniteNumber(raw.offset, `${field}.offset`),
      decodeFormula: asString(raw.decodeFormula, `${field}.decodeFormula`),
    }
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
  }
}

function parseEncoding(raw: unknown, field: string): ScalarEncodingSpec | VectorEncodingSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return 'nodata' in raw
    ? parseScalarEncoding(raw, field)
    : parseVectorEncoding(raw, field)
}

function parseComponents(raw: unknown, field: string): NonEmptyArray<string> {
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid manifest field ${field}: expected non-empty string[]`)
  }
  return asNonEmptyArray(raw.map((item, index) => (
    asNonEmptyString(item, `${field}[${index}]`)
  )), field)
}

function parseProductStyle(raw: unknown, field: string): ProductStyleSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return {
    layerId: asNonEmptyString(raw.layerId, `${field}.layerId`),
    paletteId: asNonEmptyString(raw.paletteId, `${field}.paletteId`),
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
      components: parseComponents(rawProduct.components, `${field}.components`),
      style: parseProductStyle(rawProduct.style, `${field}.style`),
      valueRange: parseValueRange(rawProduct.valueRange, `${field}.valueRange`),
      grid: parseGrid(rawProduct.grid, `${field}.grid`),
      encoding: parseEncoding(rawProduct.encoding, `${field}.encoding`),
      frames: parseFrames(rawProduct.frames, `${field}.frames`),
    }
    products[productId] = common
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

type DecodedGroup = Omit<ProductGroupSpec, 'defaultProduct' | 'products'> & {
  defaultProduct: string
  products: NonEmptyArray<string>
}

function parseGroups(raw: unknown, productsByLayerId: Record<string, NonEmptyArray<ProductId>>): DecodedGroup[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid manifest field groups: expected object[]')
  }
  if (raw.length < 1) {
    if (!productsByLayerId.scalar) return []
    throw new Error('Invalid manifest field groups: expected non-empty object[] for scalar products')
  }

  const groupIds = new Set<string>()
  const seenProductsByLayerId = new Map<string, Set<string>>()
  const groups = raw.map((rawGroup, groupIndex) => {
    const field = `groups[${groupIndex}]`
    if (!isRecord(rawGroup)) throw new Error(`Invalid manifest field ${field}: expected object`)

    const id = asString(rawGroup.id, `${field}.id`)
    if (groupIds.has(id)) throw new Error(`Manifest groups has duplicate group id ${id}`)
    groupIds.add(id)

    const layerId = asNonEmptyString(rawGroup.layerId, `${field}.layerId`)
    const label = asString(rawGroup.label, `${field}.label`)
    const defaultProduct = asString(rawGroup.defaultProductId, `${field}.defaultProductId`)
    const products = asNonEmptyArray(asStringArray(rawGroup.productIds, `${field}.productIds`), `${field}.productIds`)
    const layerProducts = productsByLayerId[layerId]
    if (!layerProducts) {
      throw new Error(`Manifest groups entry ${id} references unknown layerId ${layerId}`)
    }
    const layerProductSet = new Set(layerProducts)
    const seenProducts = seenProductsByLayerId.get(layerId) ?? new Set<string>()
    seenProductsByLayerId.set(layerId, seenProducts)

    if (!products.includes(defaultProduct)) {
      throw new Error(`Manifest groups entry ${id} defaultProductId ${defaultProduct} is not in productIds`)
    }

    for (const productId of products) {
      if (!layerProductSet.has(asProductId(productId))) {
        throw new Error(`Manifest groups entry ${id} references product ${productId} outside layer ${layerId}`)
      }
      if (seenProducts.has(productId)) {
        throw new Error(`Manifest groups assigns product ${productId} to multiple ${layerId} groups`)
      }
      seenProducts.add(productId)
    }

    return {
      id,
      layerId,
      label,
      defaultProduct,
      products,
    }
  })

  const scalarProducts = productsByLayerId.scalar ?? []
  const scalarSeenProducts = seenProductsByLayerId.get('scalar') ?? new Set<string>()
  const missingProducts = scalarProducts.filter((productId) => !scalarSeenProducts.has(productId))
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

  if (Object.keys(products).length < 1) {
    throw new Error('Invalid manifest field products: expected at least one product')
  }
  const { productsByLayerId, productStyleBindings } = deriveProductStyleData(products)
  const decodedGroups = parseGroups(raw.groups, productsByLayerId)
  const groups = decodedGroups.map((group) => ({
    id: group.id,
    layerId: group.layerId,
    label: group.label,
    defaultProduct: asProductId(group.defaultProduct),
    products: group.products.map(asProductId) as NonEmptyArray<ProductId>,
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
    productsByLayerId,
    productStyleBindings,
  }
}

function deriveProductStyleData(products: Record<string, ManifestProductSpec>): {
  productsByLayerId: Record<string, NonEmptyArray<ProductId>>
  productStyleBindings: Record<string, ProductStyleBinding>
} {
  const layerProductIds: Record<string, ProductId[]> = {}
  const productStyleBindings: Record<string, ProductStyleBinding> = {}

  for (const product of Object.values(products)) {
    const productId = asProductId(product.id)
    const layerId = product.style.layerId
    layerProductIds[layerId] ??= []
    layerProductIds[layerId].push(productId)
    productStyleBindings[product.id] = {
      productId,
      layerId,
      paletteId: product.style.paletteId,
    }
  }

  const productsByLayerId: Record<string, NonEmptyArray<ProductId>> = {}
  for (const [layerId, productIds] of Object.entries(layerProductIds)) {
    productsByLayerId[layerId] = asNonEmptyArray(productIds, `productsByLayerId.${layerId}`)
  }

  return { productsByLayerId, productStyleBindings }
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
