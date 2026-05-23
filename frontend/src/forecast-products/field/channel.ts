import type { ArtifactLoader } from '../../forecast-artifacts'
import type { LayerSpec } from '../../forecast-catalog'
import type { ActiveForecastRun } from '../../forecast-manifest'
import {
  createFieldTimeSliceCacheKey,
  createFieldChannelKey,
} from '../keys'
import type {
  FieldTimeSliceData,
  ForecastProductChannel,
} from '../types'
import { normalizeForecastHourToken } from '../../forecast-manifest'
import {
  getCachedFieldTimeSlice,
  setCachedFieldTimeSlice,
} from './cache'
import { materializeFieldTimeSlice } from './materialize'
import { loadFieldSourceData } from './source'

type CreateFieldChannelArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  layer: LayerSpec
}

export function createFieldChannel(args: CreateFieldChannelArgs): ForecastProductChannel<FieldTimeSliceData> {
  return {
    key: createFieldChannelKey(args.activeRun, args.layer),
    load: (hourToken) => loadFieldTimeSlice({
      artifacts: args.artifacts,
      activeRun: args.activeRun,
      layer: args.layer,
      hourToken,
    }),
  }
}

async function loadFieldTimeSlice(args: {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  hourToken: string
  layer: LayerSpec
}): Promise<FieldTimeSliceData> {
  const normalizedHourToken = normalizeForecastHourToken(args.hourToken)
  const cacheKey = createFieldTimeSliceCacheKey({
    activeRun: args.activeRun,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const cachedTimeSlice = getCachedFieldTimeSlice(cacheKey)
  if (cachedTimeSlice) return cachedTimeSlice

  const sourceData = await loadFieldSourceData({
    artifacts: args.artifacts,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const timeSlice = materializeFieldTimeSlice(args.layer, sourceData)

  setCachedFieldTimeSlice(cacheKey, timeSlice)

  return timeSlice
}
