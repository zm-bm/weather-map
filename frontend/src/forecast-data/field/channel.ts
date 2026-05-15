import type { ArtifactLoader } from '../../forecast-artifacts'
import type { LayerSpec } from '../../forecast-catalog'
import type { CycleManifest } from '../../manifest'
import {
  createFieldTimeSliceCacheKey,
  createFieldChannelKey,
} from '../keys'
import type {
  FieldTimeSliceData,
  ForecastDataChannel,
} from '../types'
import { normalizeHourToken } from '../window'
import {
  getCachedFieldTimeSlice,
  setCachedFieldTimeSlice,
} from './cache'
import { materializeFieldTimeSlice } from './materialize'
import { loadFieldSourceData } from './source'

type CreateFieldChannelArgs = {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  layer: LayerSpec
}

export function createFieldChannel(args: CreateFieldChannelArgs): ForecastDataChannel<FieldTimeSliceData> {
  return {
    key: createFieldChannelKey(args.manifest, args.layer),
    load: (hourToken) => loadFieldTimeSlice({
      artifacts: args.artifacts,
      manifest: args.manifest,
      layer: args.layer,
      hourToken,
    }),
  }
}

async function loadFieldTimeSlice(args: {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  hourToken: string
  layer: LayerSpec
}): Promise<FieldTimeSliceData> {
  const normalizedHourToken = normalizeHourToken(args.hourToken)
  const cacheKey = createFieldTimeSliceCacheKey({
    manifest: args.manifest,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const cachedTimeSlice = getCachedFieldTimeSlice(cacheKey)
  if (cachedTimeSlice) return cachedTimeSlice

  const sourceData = await loadFieldSourceData({
    artifacts: args.artifacts,
    manifest: args.manifest,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const timeSlice = materializeFieldTimeSlice(args.layer, sourceData)

  setCachedFieldTimeSlice(cacheKey, timeSlice)

  return timeSlice
}
