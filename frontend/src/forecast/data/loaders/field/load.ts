import type { ArtifactLoader } from '@/forecast/artifacts'
import type { ActiveForecastRun } from '@/forecast/manifest'
import type { ForecastDataLoad } from '../../loadDefinition'
import type {
  FieldTimeSliceData,
} from '../../slices'
import { normalizeForecastHourToken } from '@/forecast/manifest'
import type {
  FieldSource,
  FieldLayerSource,
} from '../../target'
import { createLruCache } from '../cache'
import { scopeDataKey } from '../dataKey'
import { materializeFieldTimeSlice } from './materialize'
import { canLoadFieldSource, loadFieldSourceData } from './source'

const FIELD_TIME_SLICE_CACHE_LIMIT = 6
const fieldTimeSliceCache = createLruCache<FieldTimeSliceData>(
  FIELD_TIME_SLICE_CACHE_LIMIT
)

type CreateFieldDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: FieldLayerSource
}

export function createFieldDataLoad(
  args: CreateFieldDataLoadArgs
): ForecastDataLoad<'field'> | null {
  if (!canLoadFieldSource({
    artifacts: args.artifacts,
    source: args.source.fieldSource,
  })) {
    return null
  }

  const key = createFieldDataKey(args.activeRun, args.source)
  return {
    id: 'field',
    key,
    failurePolicy: 'required',
    loadTimeSlice: (hourToken) => loadFieldTimeSlice({
      artifacts: args.artifacts,
      activeRun: args.activeRun,
      source: args.source,
      hourToken,
    }),
    probeField: {
      key,
      projectTimeSlice: (slice) => slice,
    },
  }
}

async function loadFieldTimeSlice(args: {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  hourToken: string
  source: FieldLayerSource
}): Promise<FieldTimeSliceData> {
  const normalizedHourToken = normalizeForecastHourToken(args.hourToken)
  const cacheKey = createFieldTimeSliceCacheKey(args.activeRun, args.source, normalizedHourToken)
  const cachedTimeSlice = fieldTimeSliceCache.get(cacheKey)
  if (cachedTimeSlice) return cachedTimeSlice

  const sourceData = await loadFieldSourceData({
    artifacts: args.artifacts,
    source: args.source.fieldSource,
    hourToken: normalizedHourToken,
  })
  const timeSlice = materializeFieldTimeSlice(args.source, sourceData)

  fieldTimeSliceCache.set(cacheKey, timeSlice)

  return timeSlice
}

export function clearFieldTimeSliceCache(): void {
  fieldTimeSliceCache.clear()
}

function createFieldDataKey(
  activeRun: ActiveForecastRun,
  source: FieldLayerSource
): string {
  return scopeDataKey(activeRun, createFieldRequestKey(source))
}

function createFieldTimeSliceCacheKey(
  activeRun: ActiveForecastRun,
  source: FieldLayerSource,
  hourToken: string
): string {
  return scopeDataKey(
    activeRun,
    `${createFieldRequestKey(source)}:${normalizeForecastHourToken(hourToken)}`
  )
}

function createFieldRequestKey(source: FieldLayerSource): string {
  return `${source.layerId}:${fieldDataSourceKey(source.fieldSource)}`
}

function fieldDataSourceKey(source: FieldSource): string {
  if (source.kind === 'scalar') return `artifact:${source.artifactId}`
  return `derived:${source.recipe}:${source.artifactId}`
}
