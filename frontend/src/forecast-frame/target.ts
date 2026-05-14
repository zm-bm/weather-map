import {
  type LayerId,
  type LayerSpec,
  type ParticleLayerId,
  type ParticleLayerSpec,
} from '../forecast-catalog'
import {
  type ForecastFrameSelection,
  type ForecastFrameWindow,
} from '../forecast-time'
import type { CycleManifest } from '../manifest'
import { createForecastFrameRequestKey } from './keys'
import { normalizeFrameHourToken } from './window'

export type ForecastFrameTarget = ForecastFrameSelection & {
  manifest: CycleManifest
  selectedLayerId: LayerId
  selectedLayer: LayerSpec
  selectedParticleLayerId: ParticleLayerId | null
  selectedParticleLayer: ParticleLayerSpec | null
  requestKey: string
}

type CreateForecastFrameTargetArgs = {
  manifest: CycleManifest
  selectedLayerId: LayerId
  selectedLayer: LayerSpec
  selectedParticleLayerId: ParticleLayerId | null
  selectedParticleLayer: ParticleLayerSpec | null
  frameWindow: ForecastFrameWindow
  retryToken: number
}

export function createForecastFrameTarget(args: CreateForecastFrameTargetArgs): ForecastFrameTarget {
  const { manifest, frameWindow } = args
  const lowerHourToken = normalizeFrameHourToken(frameWindow.lowerHourToken)
  const upperHourToken = normalizeFrameHourToken(frameWindow.upperHourToken)

  return {
    manifest,
    selectedLayerId: args.selectedLayerId,
    selectedLayer: args.selectedLayer,
    selectedParticleLayerId: args.selectedParticleLayerId,
    selectedParticleLayer: args.selectedParticleLayer,
    selectedValidTimeMs: frameWindow.selectedValidTimeMs,
    lowerHourToken,
    upperHourToken,
    mix: frameWindow.mix,
    requestKey: createForecastFrameRequestKey({
      manifest,
      selectedLayer: args.selectedLayer,
      selectedParticleLayer: args.selectedParticleLayer,
      frameWindow,
      retryToken: args.retryToken,
    }),
  }
}
