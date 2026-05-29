import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  type ActiveForecastRun,
  type ForecastModelId,
  type ForecastModelOption,
  isLayerAvailableForModel,
  resolveCompatibleActiveForecastRun,
} from '@/forecast/manifest'
import {
  getAvailableParticleLayer,
  getDefaultAvailableParticleLayerId,
  getDefaultRasterLayerId,
} from '@/forecast/catalog'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const DEFAULT_LAYER_ID = getDefaultRasterLayerId()
const noopActiveModelChange = () => undefined

export default function ForecastSelectionProvider({
  activeRun,
  modelOptions = [],
  onActiveModelChange = noopActiveModelChange,
  children,
}: {
  activeRun: ActiveForecastRun | null
  modelOptions?: readonly ForecastModelOption[]
  onActiveModelChange?: (modelId: ForecastModelId) => void
  children: ReactNode
}) {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(DEFAULT_LAYER_ID)
  const [selectedParticleLayerId, setSelectedParticleLayerId] = useState<string | null>(
    () => getDefaultAvailableParticleLayerId(activeRun)
  )

  const setActiveModel = useCallback((value: ForecastModelId) => {
    if (
      activeRun != null &&
      selectedLayerId != null &&
      !isLayerAvailableForModel(activeRun.manifest, selectedLayerId, value)
    ) {
      return
    }

    onActiveModelChange(value)
  }, [
    activeRun,
    onActiveModelChange,
    selectedLayerId,
  ])

  useEffect(() => {
    if (activeRun == null) return
    const resolvedRun = resolveCompatibleActiveForecastRun(
      activeRun,
      selectedLayerId
    )
    if (resolvedRun && resolvedRun.modelId !== activeRun.modelId) {
      onActiveModelChange(resolvedRun.modelId)
    }
  }, [
    activeRun,
    onActiveModelChange,
    selectedLayerId,
  ])

  const value = useMemo<ForecastSelectionContextValue>(() => {
    const baseValue = {
      modelOptions,
      setActiveModel,
      setSelectedLayer: setSelectedLayerId,
      setSelectedParticleLayer: setSelectedParticleLayerId,
    }

    if (!activeRun) {
      return {
        ...baseValue,
        activeRun: null,
        selectedLayerId: null,
        selectedParticleLayerId: null,
      }
    }

    const resolvedSelectedLayerId = selectedLayerId ?? DEFAULT_LAYER_ID
    const resolvedSelectedParticleLayerId =
      selectedParticleLayerId != null
      && getAvailableParticleLayer(activeRun, selectedParticleLayerId) != null
        ? selectedParticleLayerId
        : getDefaultAvailableParticleLayerId(activeRun)

    return {
      ...baseValue,
      activeRun,
      selectedLayerId: resolvedSelectedLayerId,
      selectedParticleLayerId: resolvedSelectedParticleLayerId,
    }
  }, [
    activeRun,
    modelOptions,
    selectedLayerId,
    selectedParticleLayerId,
    setActiveModel,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}
