import type { ArtifactLoader } from '../../forecast-artifacts'
import type { LayerSpec } from '../../forecast-catalog'
import type { CycleManifest } from '../../manifest'
import {
  createFieldFrameCacheKey,
  createFieldChannelKey,
} from '../keys'
import type {
  FieldFrameData,
  ForecastFrameChannel,
} from '../types'
import { normalizeFrameHourToken } from '../window'
import {
  getCachedFieldFrame,
  setCachedFieldFrame,
} from './cache'
import { materializeFieldFrame } from './materialize'
import { loadFieldSourceData } from './source'

type CreateFieldChannelArgs = {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  layer: LayerSpec
}

export function createFieldChannel(args: CreateFieldChannelArgs): ForecastFrameChannel<FieldFrameData> {
  return {
    key: createFieldChannelKey(args.manifest, args.layer),
    load: (hourToken) => loadFieldFrame({
      artifacts: args.artifacts,
      manifest: args.manifest,
      layer: args.layer,
      hourToken,
    }),
  }
}

async function loadFieldFrame(args: {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  hourToken: string
  layer: LayerSpec
}): Promise<FieldFrameData> {
  const normalizedHourToken = normalizeFrameHourToken(args.hourToken)
  const cacheKey = createFieldFrameCacheKey({
    manifest: args.manifest,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const cachedFrame = getCachedFieldFrame(cacheKey)
  if (cachedFrame) return cachedFrame

  const sourceData = await loadFieldSourceData({
    artifacts: args.artifacts,
    layer: args.layer,
    hourToken: normalizedHourToken,
  })
  const frame = materializeFieldFrame(args.layer, sourceData)

  setCachedFieldFrame(cacheKey, frame)

  return frame
}
