import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

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
} from '@/forecast/catalog'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'
import {
  DEFAULT_SELECTED_LAYER_ID,
  SELECTED_LAYER_QUERY_PARAM,
  normalizeSelectedLayerId,
  resolvePersistedSelectedLayerId,
  saveStoredSelectedLayerId,
  selectedLayerIdFromSearchParams,
} from './selectedLayerPersistence'

const DEFAULT_LAYER_ID = DEFAULT_SELECTED_LAYER_ID
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [fallbackLayerId, setFallbackLayerId] = useState<string>(
    () => resolvePersistedSelectedLayerId(searchParams)
  )
  const [selectedParticleLayerId, setSelectedParticleLayerId] = useState<string | null>(
    () => getDefaultAvailableParticleLayerId(activeRun)
  )
  const selectedLayerId = selectedLayerIdFromSearchParams(searchParams) ?? fallbackLayerId

  const updateSelectedLayerParam = useCallback((layerId: string) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(SELECTED_LAYER_QUERY_PARAM, layerId)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const setSelectedLayer = useCallback((value: string) => {
    const nextLayerId = normalizeSelectedLayerId(value) ?? DEFAULT_LAYER_ID
    setFallbackLayerId(nextLayerId)
    saveStoredSelectedLayerId(nextLayerId)
    updateSelectedLayerParam(nextLayerId)
  }, [updateSelectedLayerParam])

  useEffect(() => {
    saveStoredSelectedLayerId(selectedLayerId)

    if (searchParams.get(SELECTED_LAYER_QUERY_PARAM) === selectedLayerId) return
    updateSelectedLayerParam(selectedLayerId)
  }, [
    searchParams,
    selectedLayerId,
    updateSelectedLayerParam,
  ])

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
      setSelectedLayer,
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

    const resolvedSelectedParticleLayerId =
      selectedParticleLayerId != null
      && getAvailableParticleLayer(activeRun, selectedParticleLayerId) != null
        ? selectedParticleLayerId
        : getDefaultAvailableParticleLayerId(activeRun)

    return {
      ...baseValue,
      activeRun,
      selectedLayerId,
      selectedParticleLayerId: resolvedSelectedParticleLayerId,
    }
  }, [
    activeRun,
    modelOptions,
    selectedLayerId,
    selectedParticleLayerId,
    setActiveModel,
    setSelectedLayer,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}
