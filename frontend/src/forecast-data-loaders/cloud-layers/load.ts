import type { ArtifactLoader, RawVectorComponentArtifactData } from '../../forecast-artifacts'
import type { ActiveForecastRun } from '../../forecast-manifest'
import { getLayerPalette } from '../../forecast-palette'
import type { ForecastCloudLayerSource } from '../../forecast-data-targets'
import {
  createCloudLayersDataKey,
  createCloudLayersTimeSliceCacheKey,
} from '../keys'
import type {
  CloudLayersTimeSliceData,
  DerivedFieldEncodingSpec,
  FieldTimeSliceData,
  ForecastDataLoad,
  LoadedInterpolationWindow,
} from '../types'
import { normalizeForecastHourToken } from '../../forecast-manifest'
import {
  getCachedCloudLayersTimeSlice,
  setCachedCloudLayersTimeSlice,
} from './cache'

const CLOUD_COMPONENTS = ['low', 'middle', 'high'] as const

const CLOUD_COVERAGE_ENCODING: DerivedFieldEncodingSpec = {
  id: 'cloud-layers-coverage-derived-float32-v1',
  format: 'derived-float32-v1',
  dtype: 'float32',
  byteOrder: 'none',
  nodata: -9999,
}

type CreateCloudLayersDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: ForecastCloudLayerSource
}

export function createCloudLayersDataLoad(
  args: CreateCloudLayersDataLoadArgs
): ForecastDataLoad<'cloudLayers'> | null {
  if (!args.artifacts.canLoadVectorComponents(args.source.artifactId, CLOUD_COMPONENTS)) return null

  return {
    id: 'cloudLayers',
    key: createCloudLayersDataKey(args.activeRun, args.source),
    failurePolicy: 'required',
    loadTimeSlice: (hourToken) => loadCloudLayersTimeSlice({
      artifacts: args.artifacts,
      activeRun: args.activeRun,
      source: args.source,
      hourToken,
    }),
    toProbeField: cloudLayersProbeWindow,
  }
}

function loadCloudLayersTimeSlice(args: {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  hourToken: string
  source: ForecastCloudLayerSource
}): Promise<CloudLayersTimeSliceData> {
  const normalizedHourToken = normalizeForecastHourToken(args.hourToken)
  const cacheKey = createCloudLayersTimeSliceCacheKey({
    activeRun: args.activeRun,
    source: args.source,
    hourToken: normalizedHourToken,
  })
  const cachedTimeSlice = getCachedCloudLayersTimeSlice(cacheKey)
  if (cachedTimeSlice) return Promise.resolve(cachedTimeSlice)

  return args.artifacts.loadRawVectorComponents(args.source.artifactId, normalizedHourToken)
    .then((sourceData) => {
      const timeSlice = materializeCloudLayersTimeSlice(args.source, sourceData)
      setCachedCloudLayersTimeSlice(cacheKey, timeSlice)
      return timeSlice
    })
}

export function materializeCloudLayersTimeSlice(
  source: ForecastCloudLayerSource,
  sourceData: RawVectorComponentArtifactData
): CloudLayersTimeSliceData {
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

  const coverageValues = new Float32Array(cellCount)
  for (let idx = 0; idx < cellCount; idx += 1) {
    const coverage = deriveCoveragePercent({
      low: decodeCloudFraction(low[idx], encoding.scale, encoding.offset, encoding.nodata),
      middle: decodeCloudFraction(middle[idx], encoding.scale, encoding.offset, encoding.nodata),
      high: decodeCloudFraction(high[idx], encoding.scale, encoding.offset, encoding.nodata),
    })
    coverageValues[idx] = coverage
  }

  return {
    hourToken: sourceData.hourToken,
    layerId: source.layerId,
    artifactId: sourceData.artifactId,
    grid,
    encoding,
    low,
    middle,
    high,
    coverage: materializeCoverageField(source, sourceData, coverageValues),
  }
}

function materializeCoverageField(
  source: ForecastCloudLayerSource,
  sourceData: RawVectorComponentArtifactData,
  values: Float32Array
): FieldTimeSliceData {
  const palette = getLayerPalette(source.paletteId)
  return {
    hourToken: sourceData.hourToken,
    layerId: source.layerId,
    paletteId: source.paletteId,
    grid: sourceData.grid,
    encoding: CLOUD_COVERAGE_ENCODING,
    values,
    displayRange: source.displayRange,
    colorStops: palette.colorStops,
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

  const clearFraction = finiteValues.reduce((clearSky, value) => clearSky * (1 - value), 1)
  return clamp((1 - clearFraction) * 100, 0, 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cloudLayersProbeWindow(
  window: LoadedInterpolationWindow<CloudLayersTimeSliceData>
): LoadedInterpolationWindow<FieldTimeSliceData> {
  return {
    selectedValidTimeMs: window.selectedValidTimeMs,
    lowerHourToken: window.lowerHourToken,
    upperHourToken: window.upperHourToken,
    mix: window.mix,
    lower: window.lower.coverage,
    upper: window.upper.coverage,
  }
}
