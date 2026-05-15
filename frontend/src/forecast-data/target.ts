import {
  type LayerId,
  type LayerSpec,
  type ParticleLayerId,
  type ParticleLayerSpec,
} from '../forecast-catalog'
import {
  type ForecastTimeSliceSelection,
  type ForecastInterpolationWindow,
} from '../forecast-time'
import type { CycleManifest } from '../manifest'
import { createForecastDataRequestKey } from './keys'
import { normalizeHourToken } from './window'

export type ForecastDataTarget = ForecastTimeSliceSelection & {
  manifest: CycleManifest
  selectedLayerId: LayerId
  selectedLayer: LayerSpec
  selectedParticleLayerId: ParticleLayerId | null
  selectedParticleLayer: ParticleLayerSpec | null
  requestKey: string
}

type CreateForecastDataTargetArgs = {
  manifest: CycleManifest
  selectedLayerId: LayerId
  selectedLayer: LayerSpec
  selectedParticleLayerId: ParticleLayerId | null
  selectedParticleLayer: ParticleLayerSpec | null
  interpolationWindow: ForecastInterpolationWindow
  retryToken: number
}

export function createForecastDataTarget(args: CreateForecastDataTargetArgs): ForecastDataTarget {
  const { manifest, interpolationWindow } = args
  const lowerHourToken = normalizeHourToken(interpolationWindow.lowerHourToken)
  const upperHourToken = normalizeHourToken(interpolationWindow.upperHourToken)

  return {
    manifest,
    selectedLayerId: args.selectedLayerId,
    selectedLayer: args.selectedLayer,
    selectedParticleLayerId: args.selectedParticleLayerId,
    selectedParticleLayer: args.selectedParticleLayer,
    selectedValidTimeMs: interpolationWindow.selectedValidTimeMs,
    lowerHourToken,
    upperHourToken,
    mix: interpolationWindow.mix,
    requestKey: createForecastDataRequestKey({
      manifest,
      selectedLayer: args.selectedLayer,
      selectedParticleLayer: args.selectedParticleLayer,
      interpolationWindow,
      retryToken: args.retryToken,
    }),
  }
}
