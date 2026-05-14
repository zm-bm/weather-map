import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection'
import {
  getParticleLayerSpec,
  getLayerSpec,
} from '../forecast-catalog'
import { createForecastFrameTarget } from '../forecast-frame'
import { useForecastTimeContext } from '../forecast-time'
import {
  resolveForecastFrameWindow,
} from '../forecast-time'
import type { ForecastSyncTarget } from './types'

export function useSyncTarget(retryToken: number): ForecastSyncTarget | null {
  const {
    manifest,
    selectedLayerId,
    layers,
    selectedParticleLayerId,
    particleLayers,
  } = useForecastSelectionContext()
  const {
    state: timelineState,
    sync,
  } = useForecastTimeContext()

  return useMemo(() => {
    if (
      manifest == null ||
      selectedLayerId == null ||
      layers == null
    ) {
      return null
    }
    const selectedLayer = getLayerSpec(selectedLayerId, layers)
    const selectedParticleLayer = selectedParticleLayerId == null
      ? null
      : getParticleLayerSpec(selectedParticleLayerId, particleLayers ?? {})

    const frameWindow = resolveForecastFrameWindow(
      manifest.times,
      timelineState.targetTimeMs
    )

    return {
      ...createForecastFrameTarget({
        manifest,
        selectedLayerId,
        selectedLayer,
        selectedParticleLayerId,
        selectedParticleLayer,
        frameWindow,
        retryToken,
      }),
      sync,
    }
  }, [
    layers,
    manifest,
    particleLayers,
    retryToken,
    selectedLayerId,
    selectedParticleLayerId,
    sync,
    timelineState.targetTimeMs,
  ])
}
