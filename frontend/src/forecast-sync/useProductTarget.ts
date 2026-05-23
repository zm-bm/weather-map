import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection'
import {
  getParticleLayerSpec,
  getLayerSpec,
  particleLayerSourceArtifactId,
} from '../forecast-catalog'
import { createForecastProductTarget } from '../forecast-products'
import type { ForecastProductTarget } from '../forecast-products'
import { useForecastTimeContext } from '../forecast-time'
import {
  resolveForecastInterpolationWindow,
} from '../forecast-time'

export function useProductTarget(): ForecastProductTarget | null {
  const {
    activeRun,
    selectedLayerId,
    layers,
    selectedParticleLayerId,
    particleLayers,
    selectedLayerIsRenderable,
  } = useForecastSelectionContext()
  const { state: timelineState } = useForecastTimeContext()

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
    const windVectorSource = selectedParticleLayer == null
      ? null
      : {
        id: String(selectedParticleLayer.id),
        artifactId: particleLayerSourceArtifactId(selectedParticleLayer),
      }

    const interpolationWindow = resolveForecastInterpolationWindow(
      activeRun.latest.times,
      timelineState.targetTimeMs
    )

    return createForecastProductTarget({
      activeRun,
      selectedLayer,
      windVectorSource,
      interpolationWindow,
    })
  }, [
    activeRun,
    layers,
    particleLayers,
    selectedLayerId,
    selectedLayerIsRenderable,
    selectedParticleLayerId,
    timelineState.targetTimeMs,
  ])
}
