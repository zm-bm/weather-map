import {
  asScalarVariableId,
  asVectorVariableId,
  MANIFEST_CONTRACT,
  MANIFEST_VERSION,
  type CycleManifest,
  type FramePayloadRef,
  type ManifestEncodingSpec,
  type ManifestVariableSpec,
  type NonEmptyArray,
  type ScalarGridSpec,
  type ScalarVariableGroupSpec,
  type ScalarVariableId,
  type VectorVariableId,
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
  if (allowed.includes(value as T[number])) {
    return value as T[number]
  }
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

function asNonEmptyStringArray(v: unknown, field: string): NonEmptyArray<string> {
  const values = asStringArray(v, field)
  if (values.length < 1) {
    throw new Error(`Invalid manifest field ${field}: expected non-empty string[]`)
  }
  return values as NonEmptyArray<string>
}

function parseGrid(raw: unknown, field: string): ScalarGridSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return {
    crs: asString(raw.crs, `${field}.crs`),
    nx: asFiniteNumber(raw.nx, `${field}.nx`),
    ny: asFiniteNumber(raw.ny, `${field}.ny`),
    lon0: asFiniteNumber(raw.lon0, `${field}.lon0`),
    lat0: asFiniteNumber(raw.lat0, `${field}.lat0`),
    dx: asFiniteNumber(raw.dx, `${field}.dx`),
    dy: asFiniteNumber(raw.dy, `${field}.dy`),
    origin: asLiteralString(raw.origin, `${field}.origin`, 'cell_center'),
    layout: asLiteralString(raw.layout, `${field}.layout`, 'row_major'),
    x_wrap: asOneOfStrings(raw.x_wrap, `${field}.x_wrap`, ['repeat', 'none'] as const),
    y_mode: asLiteralString(raw.y_mode, `${field}.y_mode`, 'clamp'),
  }
}

function parseEncoding(raw: unknown, field: string): ManifestEncodingSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  const format = asString(raw.format, `${field}.format`)

  if (format === 'scalar-i16-linear-v1') {
    return {
      format: 'scalar-i16-linear-v1',
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int16'),
      byte_order: asOneOfStrings(raw.byte_order, `${field}.byte_order`, ['little', 'big'] as const),
      nodata: asFiniteNumber(raw.nodata, `${field}.nodata`),
      scale: asFiniteNumber(raw.scale, `${field}.scale`),
      offset: asFiniteNumber(raw.offset, `${field}.offset`),
      decode_formula: asString(raw.decode_formula, `${field}.decode_formula`),
    }
  }

  if (format === 'scalar-i8-linear-v1') {
    return {
      format: 'scalar-i8-linear-v1',
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byte_order: asLiteralString(raw.byte_order, `${field}.byte_order`, 'none'),
      nodata: asFiniteNumber(raw.nodata, `${field}.nodata`),
      scale: asFiniteNumber(raw.scale, `${field}.scale`),
      offset: asFiniteNumber(raw.offset, `${field}.offset`),
      decode_formula: asString(raw.decode_formula, `${field}.decode_formula`),
    }
  }

  if (format === 'scalar-i8-linear-components-v1') {
    return {
      format: 'scalar-i8-linear-components-v1',
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byte_order: asLiteralString(raw.byte_order, `${field}.byte_order`, 'none'),
      nodata: asLiteralNumber(raw.nodata, `${field}.nodata`, -128),
      scale: asLiteralNumber(raw.scale, `${field}.scale`, 5),
      offset: asLiteralNumber(raw.offset, `${field}.offset`, 0),
      decode_formula: asString(raw.decode_formula, `${field}.decode_formula`),
      components: parseCloudLayerComponents(raw.components, `${field}.components`),
      component_count: asLiteralNumber(raw.component_count, `${field}.component_count`, 3),
      component_order: asLiteralString(raw.component_order, `${field}.component_order`, 'low_medium_high'),
    }
  }

  if (format === 'scalar-i8-temp-c-piecewise-v1') {
    const nodata = asFiniteNumber(raw.nodata, `${field}.nodata`)
    if (nodata !== -128) {
      throw new Error(`Invalid manifest field ${field}.nodata: expected -128`)
    }
    return {
      format: 'scalar-i8-temp-c-piecewise-v1',
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byte_order: asLiteralString(raw.byte_order, `${field}.byte_order`, 'none'),
      nodata,
    }
  }

  if (format === 'uv-i8-q0p5-v1') {
    return {
      format: 'uv-i8-q0p5-v1',
      dtype: asLiteralString(raw.dtype, `${field}.dtype`, 'int8'),
      byte_order: asLiteralString(raw.byte_order, `${field}.byte_order`, 'none'),
      scale: asFiniteNumber(raw.scale, `${field}.scale`),
      offset: asFiniteNumber(raw.offset, `${field}.offset`),
      decode_formula: asString(raw.decode_formula, `${field}.decode_formula`),
      components: parseVectorComponents(raw.components, `${field}.components`),
      component_count: asLiteralNumber(raw.component_count, `${field}.component_count`, 2),
      component_order: asLiteralString(raw.component_order, `${field}.component_order`, 'u_then_v'),
    }
  }

  throw new Error(`Unsupported manifest encoding format at ${field}.format: ${format}`)
}

function parseVariableMeta(raw: unknown, field: string): ManifestVariableSpec {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)

  const common = {
    units: asString(raw.units, `${field}.units`),
    parameter: asString(raw.parameter, `${field}.parameter`),
    level: asString(raw.level, `${field}.level`),
    valid_min: asFiniteNumber(raw.valid_min, `${field}.valid_min`),
    valid_max: asFiniteNumber(raw.valid_max, `${field}.valid_max`),
    grid_id: asString(raw.grid_id, `${field}.grid_id`),
    encoding_id: asString(raw.encoding_id, `${field}.encoding_id`),
  } as const

  const kind = asString(raw.kind, `${field}.kind`)
  if (kind === 'scalar') {
    return { kind, ...common }
  }
  if (kind === 'vector') {
    return { kind, ...common }
  }
  throw new Error(`Invalid manifest variable kind at ${field}.kind: ${kind}`)
}

function parseFrameRef(raw: unknown, field: string): FramePayloadRef {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  return {
    path: asString(raw.path, `${field}.path`),
    byte_length: asFiniteNumber(raw.byte_length, `${field}.byte_length`),
    sha256: asString(raw.sha256, `${field}.sha256`),
  }
}

function parseRecordMap<T>(
  raw: unknown,
  field: string,
  parseItem: (itemRaw: unknown, itemField: string) => T
): Record<string, T> {
  if (!isRecord(raw)) throw new Error(`Invalid manifest field ${field}: expected object`)
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(raw)) {
    out[key] = parseItem(value, `${field}.${key}`)
  }
  return out
}

type DecodedScalarVariableGroupSpec = Omit<ScalarVariableGroupSpec, 'defaultVariable' | 'variables'> & {
  defaultVariable: string
  variables: NonEmptyArray<string>
}

type DecodedCycleManifest = Omit<CycleManifest, 'scalarVariables' | 'scalarVariableGroups' | 'vectorVariables'> & {
  scalarVariables: NonEmptyArray<string>
  scalarVariableGroups: NonEmptyArray<DecodedScalarVariableGroupSpec>
  vectorVariables: NonEmptyArray<string>
}

function fallbackScalarVariableGroups(scalarVariables: NonEmptyArray<string>): NonEmptyArray<DecodedScalarVariableGroupSpec> {
  return [{
    id: 'layers',
    label: 'Layers',
    defaultVariable: scalarVariables[0],
    variables: scalarVariables,
  }]
}

function parseScalarVariableGroups(
  raw: unknown,
  scalarVariables: NonEmptyArray<string>
): NonEmptyArray<DecodedScalarVariableGroupSpec> {
  if (raw == null) {
    return fallbackScalarVariableGroups(scalarVariables)
  }
  if (!Array.isArray(raw) || raw.length < 1) {
    throw new Error('Invalid manifest field scalar_variable_groups: expected non-empty object[]')
  }

  const scalarVariableSet = new Set(scalarVariables)
  const groupIds = new Set<string>()
  const seenVariables = new Set<string>()
  const groups = raw.map((rawGroup, groupIndex) => {
    const field = `scalar_variable_groups[${groupIndex}]`
    if (!isRecord(rawGroup)) {
      throw new Error(`Invalid manifest field ${field}: expected object`)
    }

    const id = asString(rawGroup.id, `${field}.id`)
    if (groupIds.has(id)) {
      throw new Error(`Manifest scalar_variable_groups has duplicate group id ${id}`)
    }
    groupIds.add(id)

    const label = asString(rawGroup.label, `${field}.label`)
    const defaultVariable = asString(rawGroup.default_variable, `${field}.default_variable`)
    const variables = asNonEmptyStringArray(rawGroup.variables, `${field}.variables`)

    if (!variables.includes(defaultVariable)) {
      throw new Error(
        `Manifest scalar_variable_groups entry ${id} default_variable ${defaultVariable} is not in variables`
      )
    }

    for (const variableId of variables) {
      if (!scalarVariableSet.has(variableId)) {
        throw new Error(`Manifest scalar_variable_groups entry ${id} references unknown scalar variable ${variableId}`)
      }
      if (seenVariables.has(variableId)) {
        throw new Error(`Manifest scalar_variable_groups assigns scalar variable ${variableId} to multiple groups`)
      }
      seenVariables.add(variableId)
    }

    return {
      id,
      label,
      defaultVariable,
      variables,
    }
  }) as NonEmptyArray<DecodedScalarVariableGroupSpec>

  const missingVariables = scalarVariables.filter((variableId) => !seenVariables.has(variableId))
  if (missingVariables.length > 0) {
    throw new Error(`Manifest scalar_variable_groups missing scalar variables: ${missingVariables.join(', ')}`)
  }

  return groups
}

export function decodeCycleManifest(raw: unknown): DecodedCycleManifest {
  if (!isRecord(raw)) {
    throw new Error('Cycle manifest payload is not an object')
  }

  const version = asFiniteNumber(raw.version, 'version')
  const contract = asString(raw.contract, 'contract')
  if (version !== MANIFEST_VERSION) {
    throw new Error(`Unsupported cycle manifest version: ${version} (expected ${MANIFEST_VERSION})`)
  }
  if (contract !== MANIFEST_CONTRACT) {
    throw new Error(`Unsupported cycle manifest contract: ${contract} (expected ${MANIFEST_CONTRACT})`)
  }

  const scalarVariables = asNonEmptyStringArray(raw.scalar_variables, 'scalar_variables')

  return {
    version: MANIFEST_VERSION,
    contract: MANIFEST_CONTRACT,
    cycle: asString(raw.cycle, 'cycle'),
    generatedAt: asString(raw.generated_at, 'generated_at'),
    revision: asString(raw.revision, 'revision'),
    forecastHours: asStringArray(raw.forecast_hours, 'forecast_hours'),
    scalarVariables,
    scalarVariableGroups: parseScalarVariableGroups(raw.scalar_variable_groups, scalarVariables),
    vectorVariables: asNonEmptyStringArray(raw.vector_variables, 'vector_variables'),
    grids: parseRecordMap(raw.grids, 'grids', parseGrid),
    encodings: parseRecordMap(raw.encodings, 'encodings', parseEncoding),
    variableMeta: parseRecordMap(raw.variable_meta, 'variable_meta', parseVariableMeta),
    frames: parseRecordMap(raw.frames, 'frames', (hourFramesRaw, hourField) =>
      parseRecordMap(hourFramesRaw, hourField, parseFrameRef)
    ),
  }
}

export function validateCycleManifest(manifest: DecodedCycleManifest): void {
  for (const variableId of manifest.scalarVariables) {
    const meta = manifest.variableMeta[variableId]
    if (!meta) throw new Error(`Manifest variable_meta missing entry for ${variableId}`)
    if (meta.kind !== 'scalar') {
      throw new Error(
        `Manifest scalar_variables entry ${variableId} has invalid kind ${meta.kind}; expected scalar`
      )
    }
    if (!manifest.grids[meta.grid_id]) throw new Error(`Manifest grids missing id ${meta.grid_id} for ${variableId}`)
    if (!manifest.encodings[meta.encoding_id]) throw new Error(`Manifest encodings missing id ${meta.encoding_id} for ${variableId}`)
  }

  for (const variableId of manifest.vectorVariables) {
    const meta = manifest.variableMeta[variableId]
    if (!meta) throw new Error(`Manifest variable_meta missing entry for ${variableId}`)
    if (meta.kind !== 'vector') {
      throw new Error(
        `Manifest vector_variables entry ${variableId} has invalid kind ${meta.kind}; expected vector`
      )
    }
    if (!manifest.grids[meta.grid_id]) throw new Error(`Manifest grids missing id ${meta.grid_id} for ${variableId}`)
    if (!manifest.encodings[meta.encoding_id]) throw new Error(`Manifest encodings missing id ${meta.encoding_id} for ${variableId}`)
  }
}

export function parseCycleManifest(raw: unknown): CycleManifest {
  const decoded = decodeCycleManifest(raw)
  validateCycleManifest(decoded)
  return {
    ...decoded,
    scalarVariables: decoded.scalarVariables.map(
      asScalarVariableId
    ) as NonEmptyArray<ScalarVariableId>,
    scalarVariableGroups: decoded.scalarVariableGroups.map((group) => ({
      id: group.id,
      label: group.label,
      defaultVariable: asScalarVariableId(group.defaultVariable),
      variables: group.variables.map(asScalarVariableId) as NonEmptyArray<ScalarVariableId>,
    })) as NonEmptyArray<ScalarVariableGroupSpec>,
    vectorVariables: decoded.vectorVariables.map(
      asVectorVariableId
    ) as NonEmptyArray<VectorVariableId>,
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
