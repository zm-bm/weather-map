import type { ArtifactLoader } from '../../forecast-artifacts'
import type { ActiveForecastRun } from '../../forecast-manifest'
import {
  createFieldTimeSliceCacheKey,
  createFieldDataKey,
} from '../keys'
import type {
  FieldTimeSliceData,
  ForecastDataLoad,
} from '../types'
import { normalizeForecastHourToken } from '../../forecast-manifest'
import type { ForecastFieldLayerSource } from '../../forecast-data-targets'
import {
  getCachedFieldTimeSlice,
  setCachedFieldTimeSlice,
} from './cache'
import { materializeFieldTimeSlice } from './materialize'
import { canLoadFieldSource, loadFieldSourceData } from './source'

type CreateFieldDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: ForecastFieldLayerSource
}

export function createFieldDataLoad(
  args: CreateFieldDataLoadArgs
): ForecastDataLoad<'field'> | null {
  if (!canLoadFieldSource({
    artifacts: args.artifacts,
    source: args.source.dataSource,
  })) {
    return null
  }

  return {
    id: 'field',
    key: createFieldDataKey(args.activeRun, args.source),
    failurePolicy: 'required',
    loadTimeSlice: (hourToken) => loadFieldTimeSlice({
      artifacts: args.artifacts,
      activeRun: args.activeRun,
      source: args.source,
      hourToken,
    }),
    toProbeField: (window) => window,
  }
}

async function loadFieldTimeSlice(args: {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  hourToken: string
  source: ForecastFieldLayerSource
}): Promise<FieldTimeSliceData> {
  const normalizedHourToken = normalizeForecastHourToken(args.hourToken)
  const cacheKey = createFieldTimeSliceCacheKey({
    activeRun: args.activeRun,
    source: args.source,
    hourToken: normalizedHourToken,
  })
  const cachedTimeSlice = getCachedFieldTimeSlice(cacheKey)
  if (cachedTimeSlice) return cachedTimeSlice

  const sourceData = await loadFieldSourceData({
    artifacts: args.artifacts,
    source: args.source.dataSource,
    hourToken: normalizedHourToken,
  })
  const timeSlice = materializeFieldTimeSlice(args.source, sourceData)

  setCachedFieldTimeSlice(cacheKey, timeSlice)

  return timeSlice
}
