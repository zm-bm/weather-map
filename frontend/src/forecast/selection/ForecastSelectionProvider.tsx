import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  type ForecastModelId,
  type ForecastModelOption,
  type Manifest,
  isLayerAvailableForModel,
  resolveActiveForecastRun,
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
import {
  loadStoredActiveModelId,
  normalizeActiveModelId,
  saveStoredActiveModelId,
} from './activeModelPersistence'

const DEFAULT_LAYER_ID = DEFAULT_SELECTED_LAYER_ID

export default function ForecastSelectionProvider({
  manifest,
  modelOptions = [],
  children,
}: {
  manifest: Manifest | null
  modelOptions?: readonly ForecastModelOption[]
  children: ReactNode
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [fallbackLayerId, setFallbackLayerId] = useState<string>(
    () => resolvePersistedSelectedLayerId(searchParams)
  )
  const [preferredModelId, setPreferredModelId] = useState<ForecastModelId | null>(
    () => resolveInitialActiveModelId(
      manifest,
      resolvePersistedSelectedLayerId(searchParams)
    )
  )
  const selectedLayerId = selectedLayerIdFromSearchParams(searchParams) ?? fallbackLayerId
  const activeRun = useMemo(
    () => resolveSelectedActiveRun(manifest, preferredModelId, selectedLayerId),
    [manifest, preferredModelId, selectedLayerId]
  )
  const [selectedParticleLayerId, setSelectedParticleLayerId] = useState<string | null>(
    () => getDefaultAvailableParticleLayerId(activeRun)
  )

  const updateSelectedLayerParam = useCallback((layerId: string) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(SELECTED_LAYER_QUERY_PARAM, layerId)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const setSelectedLayer = useCallback((value: string) => {
    const nextLayerId = normalizeSelectedLayerId(value) ?? DEFAULT_LAYER_ID
    setFallbackLayerId(nextLayerId)
    saveStoredSelectedLayerId(nextLayerId)
    const nextModelId = resolveSelectedActiveRun(
      manifest,
      preferredModelId,
      nextLayerId
    )?.modelId
    if (nextModelId != null && nextModelId !== preferredModelId) {
      setPreferredModelId(nextModelId)
      saveStoredActiveModelId(nextModelId)
    }
    updateSelectedLayerParam(nextLayerId)
  }, [
    manifest,
    preferredModelId,
    updateSelectedLayerParam,
  ])

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
    if (normalizeActiveModelId(manifest, value) == null) return
    if (
      selectedLayerId != null &&
      !isLayerAvailableForModel(manifest, selectedLayerId, value)
    ) {
      return
    }

    setPreferredModelId(value)
    saveStoredActiveModelId(value)
  }, [
    manifest,
    selectedLayerId,
  ])

  useEffect(() => {
    if (activeRun == null) return
    saveStoredActiveModelId(activeRun.modelId)
  }, [
    activeRun,
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
        activeModelId: null,
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
      activeModelId: activeRun.modelId,
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

function resolveInitialActiveModelId(
  manifest: Manifest | null,
  selectedLayerId: string | null
): ForecastModelId | null {
  if (manifest == null) return loadStoredActiveModelId()
  return resolveSelectedActiveRun(
    manifest,
    normalizeActiveModelId(manifest, loadStoredActiveModelId()),
    selectedLayerId
  )?.modelId ?? null
}

function resolveSelectedActiveRun(
  manifest: Manifest | null,
  preferredModelId: ForecastModelId | null,
  selectedLayerId: string | null
) {
  const preferredActiveRun = resolveActiveForecastRun(manifest, preferredModelId)
  return resolveCompatibleActiveForecastRun(preferredActiveRun, selectedLayerId)
    ?? preferredActiveRun
}
