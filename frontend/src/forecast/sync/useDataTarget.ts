import { useMemo } from 'react'

import { useForecastSelectionContext } from '@/forecast/selection'
import {
  type ForecastDataTarget,
} from '@/forecast/data'
import { useForecastTimeContext } from '@/forecast/time'
import { resolveDataTarget } from './dataTarget'

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
    return resolveDataTarget({
      activeRun,
      layers,
      selectedLayerId,
      selectedLayerIsRenderable,
      particleLayers,
      selectedParticleLayerId,
      targetTimeMs: timelineState.targetTimeMs,
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
