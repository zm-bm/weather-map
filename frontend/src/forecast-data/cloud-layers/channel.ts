import type { ArtifactLoader, RawVectorComponentArtifactData } from '../../forecast-artifacts'
import type { LayerSpec } from '../../forecast-catalog'
import { getLayerStyleByPaletteId } from '../../forecast-catalog'
import type { ActiveForecastRun } from '../../forecast-manifest'
import {
  createCloudLayersChannelKey,
  createCloudLayersTimeSliceCacheKey,
} from '../keys'
import type {
  CloudLayersTimeSliceData,
  DerivedFieldEncodingSpec,
  FieldTimeSliceData,
  ForecastDataChannel,
} from '../types'
import { normalizeHourToken } from '../window'
import {
  getCachedCloudLayersTimeSlice,
  setCachedCloudLayersTimeSlice,
} from './cache'

const CLOUD_COMPONENTS = ['low', 'middle', 'high'] as const
const CLOUD_TEXTURE_NODATA_BYTE = 255

const CLOUD_COVERAGE_ENCODING: DerivedFieldEncodingSpec = {
  id: 'cloud-layers-coverage-derived-float32-v1',
  format: 'derived-float32-v1',
  dtype: 'float32',
  byteOrder: 'none',
  nodata: -9999,
}

type CreateCloudLayersChannelArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  layer: LayerSpec
}

export function createCloudLayersChannel(args: CreateCloudLayersChannelArgs): ForecastDataChannel<CloudLayersTimeSliceData> {
  return {
    key: createCloudLayersChannelKey(args.activeRun, args.layer),
    load: (hourToken) => loadCloudLayersTimeSlice({
      artifacts: args.artifacts,
      activeRun: args.activeRun,
      layer: args.layer,
      hourToken,
    }),
  }
}

function loadCloudLayersTimeSlice(args: {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  hourToken: string
  layer: LayerSpec
}): Promise<CloudLayersTimeSliceData> {
  const normalizedHourToken = normalizeHourToken(args.hourToken)
  const cacheKey = createCloudLayersTimeSliceCacheKey({
    activeRun: args.activeRun,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const cachedTimeSlice = getCachedCloudLayersTimeSlice(cacheKey)
  if (cachedTimeSlice) return Promise.resolve(cachedTimeSlice)

  return args.artifacts.loadRawVectorComponents(args.layer.source.artifactId, normalizedHourToken)
    .then((sourceData) => {
      const timeSlice = materializeCloudLayersTimeSlice(args.layer, sourceData)
      setCachedCloudLayersTimeSlice(cacheKey, timeSlice)
      return timeSlice
    })
}

export function materializeCloudLayersTimeSlice(
  layer: LayerSpec,
  sourceData: RawVectorComponentArtifactData
): CloudLayersTimeSliceData {
  assertCloudLayersSource(layer)
  assertCloudComponentOrder(sourceData.componentIds)

  const { grid, encoding } = sourceData
  const cellCount = grid.nx * grid.ny
  const low = requiredComponent(sourceData, 'low')
  const middle = requiredComponent(sourceData, 'middle')
  const high = requiredComponent(sourceData, 'high')
  if (low.length !== cellCount || middle.length !== cellCount || high.length !== cellCount) {
    throw new Error(
      `Cloud Layers component cell count mismatch for ${sourceData.artifactId}: ` +
      `low=${low.length} middle=${middle.length} high=${high.length} expected=${cellCount}`
    )
  }

  const textureBytes = new Uint8Array(cellCount * 4)
  const coverageValues = new Float32Array(cellCount)
  for (let idx = 0; idx < cellCount; idx += 1) {
    const lowByte = cloudTextureByte(low[idx], encoding.nodata)
    const middleByte = cloudTextureByte(middle[idx], encoding.nodata)
    const highByte = cloudTextureByte(high[idx], encoding.nodata)
    const outOffset = idx * 4
    textureBytes[outOffset] = lowByte
    textureBytes[outOffset + 1] = middleByte
    textureBytes[outOffset + 2] = highByte
    textureBytes[outOffset + 3] = 255

    const coverage = deriveCoveragePercent({
      low: decodeCloudFraction(low[idx], encoding.scale, encoding.offset, encoding.nodata),
      middle: decodeCloudFraction(middle[idx], encoding.scale, encoding.offset, encoding.nodata),
      high: decodeCloudFraction(high[idx], encoding.scale, encoding.offset, encoding.nodata),
    })
    coverageValues[idx] = coverage
  }

  return {
    hourToken: sourceData.hourToken,
    layerId: String(layer.id),
    artifactId: sourceData.artifactId,
    grid,
    encoding,
    textureBytes,
    coverage: materializeCoverageField(layer, sourceData, coverageValues),
  }
}

function materializeCoverageField(
  layer: LayerSpec,
  sourceData: RawVectorComponentArtifactData,
  values: Float32Array
): FieldTimeSliceData {
  const style = getLayerStyleByPaletteId(layer.paletteId)
  return {
    hourToken: sourceData.hourToken,
    layerId: String(layer.id),
    paletteId: layer.paletteId,
    grid: sourceData.grid,
    encoding: CLOUD_COVERAGE_ENCODING,
    values,
    displayRange: [layer.displayRange.min, layer.displayRange.max],
    colortable: style.colortable,
  }
}

function assertCloudLayersSource(layer: LayerSpec): void {
  if (layer.source.kind !== 'cloud-layers') {
    throw new Error(`Layer ${layer.id} is not a cloud-layers source`)
  }
}

function assertCloudComponentOrder(componentIds: readonly string[]): void {
  const matches = componentIds.length === CLOUD_COMPONENTS.length &&
    CLOUD_COMPONENTS.every((componentId, index) => componentIds[index] === componentId)
  if (!matches) {
    throw new Error(`Cloud Layers requires components ${CLOUD_COMPONENTS.join(', ')}; got ${componentIds.join(', ')}`)
  }
}

function requiredComponent(
  sourceData: RawVectorComponentArtifactData,
  componentId: typeof CLOUD_COMPONENTS[number]
): Int8Array {
  const component = sourceData.components[componentId]
  if (!component) {
    throw new Error(`Cloud Layers missing component ${componentId}`)
  }
  return component
}

function cloudTextureByte(stored: number, nodata: number | undefined): number {
  if (nodata != null && stored === nodata) return CLOUD_TEXTURE_NODATA_BYTE
  if (!Number.isFinite(stored) || stored < 0 || stored >= CLOUD_TEXTURE_NODATA_BYTE) {
    throw new Error(`Unsupported cloud component stored value: ${stored}`)
  }
  return stored
}

function decodeCloudFraction(
  stored: number,
  scale: number,
  offset: number,
  nodata: number | undefined
): number | null {
  if (nodata != null && stored === nodata) return null
  const percent = (stored * scale) + offset
  if (!Number.isFinite(percent)) return null
  return clamp(percent / 100, 0, 1)
}

function deriveCoveragePercent(args: {
  low: number | null
  middle: number | null
  high: number | null
}): number {
  const values = [args.low, args.middle, args.high]
  const finiteValues = values.filter((value): value is number => value != null)
  if (finiteValues.length === 0) return Number.NaN

  const clearFraction = finiteValues.reduce((product, value) => product * (1 - value), 1)
  return clamp((1 - clearFraction) * 100, 0, 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
