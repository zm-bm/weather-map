import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection'
import {
  getParticleLayerSpec,
  getLayerSpec,
} from '../forecast-catalog'
import { createForecastDataTarget } from '../forecast-data'
import { useForecastTimeContext } from '../forecast-time'
import {
  resolveForecastInterpolationWindow,
} from '../forecast-time'
import type { ForecastSyncTarget } from './types'

export function useSyncTarget(retryToken: number): ForecastSyncTarget | null {
  const {
    activeRun,
    selectedLayerId,
    layers,
    selectedParticleLayerId,
    particleLayers,
    selectedLayerIsRenderable,
  } = useForecastSelectionContext()
  const {
    state: timelineState,
    sync,
  } = useForecastTimeContext()

  return useMemo(() => {
    if (
      activeRun == null ||
      selectedLayerId == null ||
      layers == null
    ) {
      return null
    }
    const selectedLayer = getLayerSpec(selectedLayerId, layers)
    if (!selectedLayerIsRenderable) {
      return null
    }
    const selectedParticleLayer = selectedParticleLayerId == null
      ? null
      : getParticleLayerSpec(selectedParticleLayerId, particleLayers ?? {})

    const interpolationWindow = resolveForecastInterpolationWindow(
      activeRun.latest.times,
      timelineState.targetTimeMs
    )

    return {
      ...createForecastDataTarget({
        activeRun,
        selectedLayerId,
        selectedLayer,
        selectedParticleLayerId,
        selectedParticleLayer,
        interpolationWindow,
        retryToken,
      }),
      sync,
    }
  }, [
    activeRun,
    layers,
    particleLayers,
    retryToken,
    selectedLayerId,
    selectedLayerIsRenderable,
    selectedParticleLayerId,
    sync,
    timelineState.targetTimeMs,
  ])
}
