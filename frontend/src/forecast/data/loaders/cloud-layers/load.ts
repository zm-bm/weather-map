import type { ArtifactLoader, RawVectorComponentArtifactData } from '@/forecast/artifacts'
import type { ActiveForecastRun } from '@/forecast/manifest'
import type { ForecastDataLoad } from '../../loadDefinition'
import type {
  CloudLayersTimeSliceData,
  DerivedFieldEncodingSpec,
  FieldTimeSliceData,
} from '../../slices'
import type { CloudLayerSource } from '../../target'
import { normalizeForecastHourToken } from '@/forecast/manifest'
import { clamp, clamp01 } from '@/core/math'
import { createLruCache } from '../cache'
import { scopeDataKey } from '../dataKey'

const CLOUD_COMPONENTS = ['low', 'middle', 'high'] as const
const CLOUD_LAYERS_TIME_SLICE_CACHE_LIMIT = 4

const cloudLayersTimeSliceCache = createLruCache<CloudLayersTimeSliceData>(
  CLOUD_LAYERS_TIME_SLICE_CACHE_LIMIT
)

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
  source: CloudLayerSource
}

export function createCloudLayersDataLoad(
  args: CreateCloudLayersDataLoadArgs
): ForecastDataLoad<'cloudLayers'> | null {
  if (!args.artifacts.canLoadVectorComponents(args.source.artifactId, CLOUD_COMPONENTS)) return null

  const key = createCloudLayersDataKey(args.activeRun, args.source)
  return {
    id: 'cloudLayers',
    key,
    failurePolicy: 'required',
    loadTimeSlice: (hourToken) => loadCloudLayersTimeSlice({
      artifacts: args.artifacts,
      activeRun: args.activeRun,
      source: args.source,
      hourToken,
    }),
    probeField: {
      key,
      projectTimeSlice: (slice) => slice.coverage,
    },
  }
}

function loadCloudLayersTimeSlice(args: {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  hourToken: string
  source: CloudLayerSource
}): Promise<CloudLayersTimeSliceData> {
  const normalizedHourToken = normalizeForecastHourToken(args.hourToken)
  const cacheKey = createCloudLayersTimeSliceCacheKey(args.activeRun, args.source, normalizedHourToken)
  const cachedTimeSlice = cloudLayersTimeSliceCache.get(cacheKey)
  if (cachedTimeSlice) return Promise.resolve(cachedTimeSlice)

  return args.artifacts.loadRawVectorComponents(args.source.artifactId, normalizedHourToken)
    .then((sourceData) => {
      const timeSlice = materializeCloudLayersTimeSlice(args.source, sourceData)
      cloudLayersTimeSliceCache.set(cacheKey, timeSlice)
      return timeSlice
    })
}

export function materializeCloudLayersTimeSlice(
  source: CloudLayerSource,
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
  source: CloudLayerSource,
  sourceData: RawVectorComponentArtifactData,
  values: Float32Array
): FieldTimeSliceData {
  return {
    hourToken: sourceData.hourToken,
    layerId: source.layerId,
    paletteId: source.paletteId,
    grid: sourceData.grid,
    encoding: CLOUD_COVERAGE_ENCODING,
    values,
    displayRange: source.displayRange,
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
  return clamp01(percent / 100)
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

function createCloudLayersDataKey(
  activeRun: ActiveForecastRun,
  source: CloudLayerSource
): string {
  return scopeDataKey(activeRun, createCloudLayersRequestKey(source))
}

function createCloudLayersTimeSliceCacheKey(
  activeRun: ActiveForecastRun,
  source: CloudLayerSource,
  hourToken: string
): string {
  return scopeDataKey(
    activeRun,
    `${createCloudLayersRequestKey(source)}:${normalizeForecastHourToken(hourToken)}`
  )
}

function createCloudLayersRequestKey(source: CloudLayerSource): string {
  return `${source.layerId}:cloud-layers:${source.artifactId}`
}
