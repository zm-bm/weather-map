import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection'
import {
  getParticleLayerSpec,
  getLayerSpec,
} from '../forecast-catalog'
import {
  createLayerDataSource,
  createForecastDataTarget,
  createWindVectorDataSource,
} from '../forecast-data-targets'
import type { ForecastDataTarget } from '../forecast-data-targets'
import { useForecastTimeContext } from '../forecast-time'
import {
  resolveForecastInterpolationWindow,
} from '../forecast-time'

export function useDataTarget(): ForecastDataTarget | null {
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
    const windVectorDataSource = selectedParticleLayer == null
      ? null
      : createWindVectorDataSource(selectedParticleLayer)

    const interpolationWindow = resolveForecastInterpolationWindow(
      activeRun.latest.times,
      timelineState.targetTimeMs
    )

    return createForecastDataTarget({
      activeRun,
      layerDataSource: createLayerDataSource(selectedLayer),
      windVectorDataSource,
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
